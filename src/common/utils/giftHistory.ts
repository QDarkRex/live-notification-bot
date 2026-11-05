import db from "@/common/utils/db";
import type { GifterTotal } from "@/common/utils/giftPeriods";
import { sessionLeaderboard } from "@/common/utils/giftTracker";
import { countLeadChanges } from "@/common/utils/podiumStats";

/**
 * Live history for /riwayat and /nowlive: per-live metadata (title, start/end,
 * viewers) and the 60 s "race" snapshots used for lead-change counts.
 * Every write is idempotent and retried on SQLITE_BUSY (see AGENTS.md).
 */

const RACE_INTERVAL_MS = 60_000;
const RACE_KEEP_MS = 60 * 24 * 3600_000;
const PRUNE_EVERY_MS = 3600_000;

function exec(sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
}

function all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))),
  );
}

async function withRetry(sql: string, params: unknown[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await exec(sql, params);
    } catch (err) {
      if ((err as { code?: string }).code !== "SQLITE_BUSY" || attempt >= 5) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt + Math.random() * 250));
    }
  }
}

export interface LiveMeta {
  slug: string;
  streamerUuid: string;
  title: string;
  imageUrl: string;
  startedAt: number | null;
  viewCount: number | null;
}

/** Insert or refresh a live's metadata. The first start time and an end time are never overwritten. */
export async function upsertLiveMeta(meta: LiveMeta): Promise<void> {
  await withRetry(
    `INSERT INTO idn_sessions_meta (slug, streamer_uuid, title, image_url, started_at, view_count)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (slug) DO UPDATE SET
       title = excluded.title,
       image_url = excluded.image_url,
       view_count = excluded.view_count,
       started_at = COALESCE(idn_sessions_meta.started_at, excluded.started_at)`,
    [meta.slug, meta.streamerUuid, meta.title, meta.imageUrl, meta.startedAt, meta.viewCount],
  );
}

/** Stamp the end time once; a live we never saw start still gets a row. */
export async function markLiveEnded(slug: string, streamerUuid: string, now: number): Promise<void> {
  await withRetry(
    `INSERT INTO idn_sessions_meta (slug, streamer_uuid, ended_at) VALUES (?, ?, ?)
     ON CONFLICT (slug) DO UPDATE SET ended_at = COALESCE(idn_sessions_meta.ended_at, excluded.ended_at)`,
    [slug, streamerUuid, now],
  );
}

/** Viewer count and start time of the lives currently stored, keyed by slug. */
export async function liveSnapshotBySlug(): Promise<
  Map<string, { viewCount: number | null; startedAt: number | null }>
> {
  const rows = await all<{ slug: string; view_count: number | null; started_at: number | null }>(
    "SELECT slug, view_count, started_at FROM idn_sessions_meta WHERE ended_at IS NULL",
  );
  return new Map(rows.map((r) => [r.slug, { viewCount: r.view_count, startedAt: r.started_at }]));
}

const lastRace = new Map<string, number>();
let lastPrune = 0;

/**
 * Record the session's current top 3 at most once a minute. Uses the tracker's
 * stored data only (no API call); the throttle is checked before any query.
 */
export async function maybeRecordRace(slug: string, now = Date.now()): Promise<void> {
  const last = lastRace.get(slug) ?? 0;
  if (now - last < RACE_INTERVAL_MS) return;
  lastRace.set(slug, now);
  try {
    const top = await sessionLeaderboard(slug, 3);
    if (!top || top.length === 0) return;
    await withRetry(
      `INSERT OR IGNORE INTO gift_race_snapshots
         (slug, at, rank1_uuid, rank1_gold, rank2_uuid, rank2_gold, rank3_uuid, rank3_gold)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        slug,
        now,
        top[0]?.uuid,
        top[0]?.gold,
        top[1]?.uuid ?? null,
        top[1]?.gold ?? null,
        top[2]?.uuid ?? null,
        top[2]?.gold ?? null,
      ],
    );
    if (now - lastPrune >= PRUNE_EVERY_MS) {
      lastPrune = now;
      await withRetry("DELETE FROM gift_race_snapshots WHERE at < ?", [now - RACE_KEEP_MS]);
    }
  } catch (err) {
    lastRace.delete(slug); // try again on the next poll
    console.error(`[gifts] failed to record race snapshot for ${slug}:`, err);
  }
}

/** How many times the #1 gifter changed during a session; 0 when unknown. */
export async function leadChangesFor(slug: string): Promise<number> {
  try {
    const rows = await all<{ rank1_uuid: string | null }>(
      "SELECT rank1_uuid FROM gift_race_snapshots WHERE slug = ? ORDER BY at",
      [slug],
    );
    return countLeadChanges(rows.map((r) => r.rank1_uuid));
  } catch (err) {
    console.error(`[gifts] failed to read race snapshots for ${slug}:`, err);
    return 0;
  }
}

export interface HistoryEntry {
  slug: string;
  streamerUuid: string;
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  gifters: GifterTotal[];
}

/**
 * Most recent finished lives (newest first), optionally for one streamer.
 * A live counts as finished when no idn_live row still carries its slug.
 */
export async function recentSessions(
  limit: number,
  options: { streamerUuid?: string; allowed?: Set<string> } = {},
): Promise<HistoryEntry[]> {
  const rows = await all<{
    slug: string;
    streamer_uuid: string;
    started_at: number;
    title: string | null;
    meta_started: number | null;
    ended_at: number | null;
  }>(
    `SELECT s.slug, s.streamer_uuid, s.started_at, m.title, m.started_at AS meta_started, m.ended_at
     FROM gift_sessions s LEFT JOIN idn_sessions_meta m ON m.slug = s.slug
     WHERE NOT EXISTS (SELECT 1 FROM idn_live l WHERE l.slug = s.slug)
       ${options.streamerUuid ? "AND s.streamer_uuid = ?" : ""}
     ORDER BY s.started_at DESC LIMIT 200`,
    options.streamerUuid ? [options.streamerUuid] : [],
  );
  const result: HistoryEntry[] = [];
  for (const row of rows) {
    if (options.allowed && !options.allowed.has(row.streamer_uuid)) continue;
    const gifters = await sessionLeaderboard(row.slug, null);
    if (!gifters) continue;
    result.push({
      slug: row.slug,
      streamerUuid: row.streamer_uuid,
      title: row.title?.trim() || null,
      startedAt: row.meta_started ?? row.started_at,
      endedAt: row.ended_at,
      gifters,
    });
    if (result.length >= limit) break;
  }
  return result;
}
