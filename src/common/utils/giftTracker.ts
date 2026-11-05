import { readFileSync } from "node:fs";
import type { Member } from "@/commands/schedule";
import db from "@/common/utils/db";
import { chatDailyTotals } from "@/common/utils/giftChat";
import { type GifterTotal, isNewPeriod, rankGifters, sessionTotals, wibDate } from "@/common/utils/giftPeriods";

/**
 * Persists IDN gift rankings per reset period (see giftPeriods.ts), so we can
 * report a live session's real totals across midnight and keep cumulative
 * per-member totals for events like the IDN Live "Best Supporter" leaderboard.
 */

function run(sql: string, params: unknown[] = []): Promise<number> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this.lastID);
    });
  });
}

function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[])));
  });
}

function get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T | undefined)));
  });
}

interface TotalRow {
  gifter_uuid: string;
  gifter_name: string;
  total_gold: number;
  total_point: number;
}

const toGifter = (r: TotalRow): GifterTotal => ({
  uuid: r.gifter_uuid,
  name: r.gifter_name,
  gold: r.total_gold,
  point: r.total_point,
});

async function createPeriod(streamerUuid: string, now: number): Promise<number> {
  return run("INSERT INTO gift_periods (streamer_uuid, day, created_at, updated_at) VALUES (?, ?, ?, ?)", [
    streamerUuid,
    wibDate(now),
    now,
    now,
  ]);
}

async function latestPeriodRow(
  streamerUuid: string,
): Promise<{ id: number; day: string; updated_at: number } | undefined> {
  return get<{ id: number; day: string; updated_at: number }>(
    "SELECT id, day, updated_at FROM gift_periods WHERE streamer_uuid = ? ORDER BY id DESC LIMIT 1",
    [streamerUuid],
  );
}

async function latestPeriod(streamerUuid: string): Promise<number | undefined> {
  return (await latestPeriodRow(streamerUuid))?.id;
}

async function periodTotals(periodId: number): Promise<GifterTotal[]> {
  const rows = await all<TotalRow>(
    "SELECT gifter_uuid, gifter_name, total_gold, total_point FROM gift_period_totals WHERE period_id = ?",
    [periodId],
  );
  return rows.map(toGifter);
}

/** Remember which period a live session started in and what it already held. */
async function ensureSession(slug: string, streamerUuid: string, now: number): Promise<void> {
  const existing = await get("SELECT 1 FROM gift_sessions WHERE slug = ?", [slug]);
  if (existing) return;
  const periodId = (await latestPeriod(streamerUuid)) ?? (await createPeriod(streamerUuid, now));
  // Baseline first, session row last: if a write fails halfway, the session
  // doesn't exist yet and the retry rebuilds the baseline from scratch.
  for (const g of await periodTotals(periodId)) {
    await run(
      "INSERT OR IGNORE INTO gift_session_baseline (slug, gifter_uuid, total_gold, total_point) VALUES (?, ?, ?, ?)",
      [slug, g.uuid, g.gold, g.point],
    );
  }
  await run(
    "INSERT OR IGNORE INTO gift_sessions (slug, streamer_uuid, start_period_id, started_at) VALUES (?, ?, ?, ?)",
    [slug, streamerUuid, periodId, now],
  );
}

/**
 * Gifts in the last seconds before midnight are often missed by polling (IDN's
 * ranking lags, then resets). The chat ledger saw them, so raise the closed
 * period's per-gifter totals to the chat's. MAX only, never add: idempotent and
 * retry-safe, and chat can't inflate a total the poll already has.
 */
async function reconcilePeriodWithChat(streamerUuid: string, periodId: number, day: string): Promise<void> {
  for (const g of await chatDailyTotals(streamerUuid, day)) {
    await run(
      `INSERT INTO gift_period_totals (period_id, gifter_uuid, gifter_name, total_gold, total_point)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (period_id, gifter_uuid) DO UPDATE SET
         total_gold = MAX(total_gold, excluded.total_gold),
         total_point = MAX(total_point, excluded.total_point)`,
      [periodId, g.uuid, g.name, g.gold, g.point],
    );
  }
}

async function applySnapshot(streamerUuid: string, gifters: GifterTotal[], slug?: string): Promise<void> {
  const now = Date.now();
  // The session must be anchored BEFORE this snapshot lands, so gifts from an
  // earlier live the same day end up in the baseline, not in this session.
  if (slug) await ensureSession(slug, streamerUuid, now);
  if (gifters.length === 0) return; // nothing new, and an empty reply is no evidence of a reset

  const latest = await latestPeriodRow(streamerUuid);
  let periodId: number;
  if (latest === undefined) {
    periodId = await createPeriod(streamerUuid, now);
  } else {
    periodId = latest.id;
    const prev = new Map((await periodTotals(periodId)).map((g) => [g.uuid, g.gold]));
    if (isNewPeriod(prev, gifters, latest.day, latest.updated_at, now)) {
      // Before opening the new period, so a failed retry redoes it (idempotent).
      await reconcilePeriodWithChat(streamerUuid, latest.id, latest.day);
      periodId = await createPeriod(streamerUuid, now);
      console.log(`[gifts] ${streamerUuid}: IDN ranking reset, new period ${periodId} (${wibDate(now)})`);
    }
  }

  for (const g of gifters) {
    await run(
      `INSERT INTO gift_period_totals (period_id, gifter_uuid, gifter_name, total_gold, total_point)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (period_id, gifter_uuid) DO UPDATE SET
         gifter_name = excluded.gifter_name,
         total_gold = MAX(total_gold, excluded.total_gold),
         total_point = MAX(total_point, excluded.total_point)`,
      [periodId, g.uuid, g.name, g.gold, g.point],
    );
  }
  await run("UPDATE gift_periods SET updated_at = ? WHERE id = ?", [now, periodId]);
}

// The production build bundles each event/command file separately, each with
// its own copy of db.ts, so several connections write the same file. SQLite
// can answer one of two concurrent writers with SQLITE_BUSY at once (deadlock
// avoidance, the busy timeout doesn't help), so retry: a snapshot is cumulative
// and every write here is idempotent, so applying it again is safe.
async function applyWithRetry(streamerUuid: string, gifters: GifterTotal[], slug?: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await applySnapshot(streamerUuid, gifters, slug);
    } catch (err) {
      if ((err as { code?: string }).code !== "SQLITE_BUSY" || attempt >= 5) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt + Math.random() * 250));
    }
  }
}

// One write at a time per streamer: the 15s poll, the end-of-live poll and the
// nightly sweep can otherwise interleave and both decide to open a period.
const queues = new Map<string, Promise<void>>();

/** Record one top-rank snapshot for a streamer (with the slug when they're live). */
export function recordSnapshot(streamerUuid: string, gifters: GifterTotal[], slug?: string): Promise<void> {
  const prev = queues.get(streamerUuid) ?? Promise.resolve();
  const next = prev
    .then(() => applyWithRetry(streamerUuid, gifters, slug))
    .catch((err) => console.error(`[gifts] failed to record snapshot for ${streamerUuid}:`, err));
  queues.set(streamerUuid, next);
  return next;
}

/** Gifters summed across midnight; null if untracked. Pass a null limit for every gifter. */
export async function sessionLeaderboard(slug: string, limit: number | null = 10): Promise<GifterTotal[] | null> {
  const session = await get<{ streamer_uuid: string; start_period_id: number; started_at: number; rowid: number }>(
    "SELECT rowid, streamer_uuid, start_period_id, started_at FROM gift_sessions WHERE slug = ?",
    [slug],
  );
  if (!session) return null;
  // The next session's baseline freezes the last period before that live's gifts.
  // Use it instead of the mutable totals in that boundary period.
  const next = await get<{ slug: string; start_period_id: number }>(
    `SELECT slug, start_period_id FROM gift_sessions
     WHERE streamer_uuid = ? AND (started_at > ? OR (started_at = ? AND rowid > ?))
     ORDER BY started_at, rowid LIMIT 1`,
    [session.streamer_uuid, session.started_at, session.started_at, session.rowid],
  );
  const rows = await all<TotalRow>(
    `SELECT t.gifter_uuid, t.gifter_name, t.total_gold, t.total_point
     FROM gift_period_totals t JOIN gift_periods p ON p.id = t.period_id
     WHERE p.streamer_uuid = ? AND p.id >= ? ${next ? "AND p.id < ?" : ""} ORDER BY p.id`,
    next
      ? [session.streamer_uuid, session.start_period_id, next.start_period_id]
      : [session.streamer_uuid, session.start_period_id],
  );
  if (next) {
    const boundary = await all<TotalRow>(
      `SELECT b.gifter_uuid, COALESCE(t.gifter_name, b.gifter_uuid) AS gifter_name,
              b.total_gold, b.total_point
       FROM gift_session_baseline b LEFT JOIN gift_period_totals t
         ON t.period_id = ? AND t.gifter_uuid = b.gifter_uuid
       WHERE b.slug = ?`,
      [next.start_period_id, next.slug],
    );
    rows.push(...boundary);
  }
  const baseline = await all<TotalRow>(
    "SELECT gifter_uuid, '' AS gifter_name, total_gold, total_point FROM gift_session_baseline WHERE slug = ?",
    [slug],
  );
  const result = sessionTotals(rows.map(toGifter), new Map(baseline.map((b) => [b.gifter_uuid, toGifter(b)])));
  return limit === null ? result : result.slice(0, limit);
}

export interface FinishedSession {
  slug: string;
  streamer_uuid: string;
  started_at: number;
  gifters: GifterTotal[];
}

/** Read tracked sessions since a timestamp, omitting every streamer currently live. */
export async function finishedSessions(sinceMs: number): Promise<FinishedSession[]> {
  const sessions = await all<{ slug: string; streamer_uuid: string; started_at: number }>(
    `SELECT s.slug, s.streamer_uuid, s.started_at FROM gift_sessions s
     WHERE s.started_at >= ?
       AND NOT EXISTS (SELECT 1 FROM idn_live l WHERE l.user_id = s.streamer_uuid)
     ORDER BY s.started_at`,
    [sinceMs],
  );
  const result: FinishedSession[] = [];
  for (const session of sessions) {
    const gifters = await sessionLeaderboard(session.slug, null);
    if (gifters) result.push({ ...session, gifters });
  }
  return result;
}

/** Tracked gold per streamer for periods first seen within [startDay, endDay] (WIB dates). */
export async function streamerTotals(
  startDay: string,
  endDay: string,
): Promise<{ streamer_uuid: string; gold: number; point: number; supporters: number }[]> {
  return all(
    `SELECT p.streamer_uuid, SUM(t.total_gold) AS gold, SUM(t.total_point) AS point,
            COUNT(DISTINCT t.gifter_uuid) AS supporters
     FROM gift_periods p JOIN gift_period_totals t ON t.period_id = p.id
     WHERE p.day BETWEEN ? AND ?
     GROUP BY p.streamer_uuid ORDER BY gold DESC, point DESC`,
    [startDay, endDay],
  );
}

/** One streamer's supporters for periods first seen within [startDay, endDay] (WIB dates). */
export async function streamerSupporters(
  streamerUuid: string,
  startDay: string,
  endDay: string,
): Promise<GifterTotal[]> {
  const rows = await all<TotalRow>(
    `SELECT t.gifter_uuid, t.gifter_name, t.total_gold, t.total_point
     FROM gift_period_totals t JOIN gift_periods p ON p.id = t.period_id
     WHERE p.streamer_uuid = ? AND p.day BETWEEN ? AND ? ORDER BY p.id`,
    [streamerUuid, startDay, endDay],
  );
  return sessionTotals(rows.map(toGifter), new Map());
}

/** First day anything was recorded, so the command can say where its numbers start. */
export async function firstTrackedDay(): Promise<string | undefined> {
  return (await get<{ day: string }>("SELECT MIN(day) AS day FROM gift_periods"))?.day ?? undefined;
}

export interface Streamer {
  uuid: string;
  username: string;
  /** Short display name, e.g. "Aralie". */
  name: string;
  /** Full member name from member.json, e.g. "Abigail Rachel". */
  fullName?: string;
}

export function rememberStreamer(uuid: string, username: string, name: string): Promise<void> {
  return new Promise((resolve, reject) =>
    db.run(
      "INSERT INTO idn_streamers (uuid, username, name, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (uuid) DO UPDATE SET username = excluded.username, name = excluded.name, updated_at = excluded.updated_at",
      [uuid, username, name, Date.now()],
      (err) => (err ? reject(err) : resolve()),
    ),
  );
}

function membersFromJson(includeGraduates = false): Streamer[] {
  try {
    const members: Member[] = JSON.parse(readFileSync("member.json", "utf8"));
    const out: Streamer[] = [];
    for (const m of members) {
      if (!includeGraduates && m.is_graduate) continue;
      const idn = (m.socials ?? []).find((s) => s.title === "IDN")?.url ?? "";
      const uuid = /profile\/([0-9a-f-]{36})/.exec(idn)?.[1];
      if (uuid) out.push({ uuid, username: m.idn_username ?? "", name: m.nicknames[0] ?? m.name, fullName: m.name });
    }
    return out;
  } catch (err) {
    console.error("[gifts] failed to read member.json", err);
    return [];
  }
}

/** UUIDs from every member.json entry, including graduates. */
export function allMemberUuids(): Set<string> {
  return new Set(membersFromJson(true).map((member) => member.uuid));
}

/** UUIDs for active member.json entries. */
export function activeMemberUuids(): Set<string> {
  return new Set(membersFromJson().map((member) => member.uuid));
}

/** Warn once per WIB day for a likely member account missing from member.json. */
export async function warnMissingMember(uuid: string, username: string, name: string): Promise<void> {
  if (!username.startsWith("jkt48_") || allMemberUuids().has(uuid)) return;
  const day = wibDate(Date.now());
  await new Promise<void>((resolve, reject) =>
    db.run(
      `INSERT INTO idn_missing_member_warnings (uuid, day) VALUES (?, ?)
       ON CONFLICT (uuid) DO UPDATE SET day = excluded.day
       WHERE idn_missing_member_warnings.day <> excluded.day`,
      [uuid, day],
      function (err) {
        if (err) reject(err);
        else {
          if (this.changes > 0)
            console.warn(`[gifts] IDN account missing from member.json: ${username} (${name}, ${uuid})`);
          resolve();
        }
      },
    ),
  );
}

/** Everyone we can track: active members in member.json plus anyone seen live on IDN. */
export async function knownStreamers(): Promise<Streamer[]> {
  const byUuid = new Map<string, Streamer>();
  const seen = await all<{ uuid: string; username: string; name: string }>(
    "SELECT uuid, username, name FROM idn_streamers",
  );
  for (const s of seen) byUuid.set(s.uuid, { ...s, name: s.name.replace(/\s*JKT48$/i, "") });
  // member.json nicknames win: they're the names fans use.
  for (const m of membersFromJson())
    byUuid.set(m.uuid, { ...m, username: m.username || byUuid.get(m.uuid)?.username || "" });
  return [...byUuid.values()];
}

export { rankGifters, type GifterTotal };
