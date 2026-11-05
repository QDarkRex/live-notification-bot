import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
let testDir: string | undefined;
let closeDatabase: (() => Promise<void>) | undefined;

async function load() {
  testDir = mkdtempSync(path.join(tmpdir(), "gift-history-"));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DB_PATH: path.join(testDir, "whitelist.db"),
    BOT_TOKEN: "x",
    DISCORD_WEBHOOK_URL: "http://localhost",
    FLARE_SOLVER_BASE: "http://localhost",
    OWNER_ID: "1",
    WEBHOOK_APPROVAL_ID: "1",
    X_API_KEY: "x",
  });
  vi.resetModules();
  const db = (await import("@/common/utils/db")).default;
  closeDatabase = () => new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
  const tracker = await import("../giftTracker");
  const history = await import("../giftHistory");
  return { tracker, history, db };
}

afterEach(async () => {
  vi.useRealTimers();
  if (closeDatabase) await closeDatabase();
  closeDatabase = undefined;
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
  process.env = { ...originalEnv };
});

const g = (uuid: string, gold: number) => ({ uuid, name: uuid, gold, point: gold * 4 });
const all = (db: any, sql: string, params: unknown[] = []): Promise<any[]> =>
  new Promise((resolve, reject) => db.all(sql, params, (e: Error | null, r: any[]) => (e ? reject(e) : resolve(r))));
const exec = (db: any, sql: string, params: unknown[] = []): Promise<void> =>
  new Promise((resolve, reject) => db.run(sql, params, (e: Error | null) => (e ? reject(e) : resolve())));

describe("live metadata", () => {
  it("keeps the first start and end time, refreshes title and viewers", async () => {
    const { history, db } = await load();
    const base = { slug: "s1", streamerUuid: "m", imageUrl: "i" };
    await history.upsertLiveMeta({ ...base, title: "A", startedAt: 1000, viewCount: 5 });
    await history.upsertLiveMeta({ ...base, title: "B", startedAt: 2000, viewCount: 9 });
    expect((await history.liveSnapshotBySlug()).get("s1")).toEqual({ viewCount: 9, startedAt: 1000 });
    await history.markLiveEnded("s1", "m", 5000);
    await history.markLiveEnded("s1", "m", 9000);
    expect(await all(db, "SELECT * FROM idn_sessions_meta")).toEqual([
      { slug: "s1", streamer_uuid: "m", title: "B", image_url: "i", started_at: 1000, ended_at: 5000, view_count: 9 },
    ]);
    expect((await history.liveSnapshotBySlug()).size).toBe(0);
  });

  it("creates an end-only row for a live we never saw start", async () => {
    const { history, db } = await load();
    await history.markLiveEnded("late", "m", 7);
    expect((await all(db, "SELECT slug, ended_at, title FROM idn_sessions_meta"))[0]).toEqual({
      slug: "late",
      ended_at: 7,
      title: null,
    });
  });
});

describe("race snapshots", () => {
  it("records at most once a minute, counts lead changes and prunes after 60 days", async () => {
    const { tracker, history, db } = await load();
    const t0 = Date.parse("2026-11-05T12:00:00+07:00");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    await tracker.recordSnapshot("m", [g("a", 10), g("b", 5)], "live");
    await history.maybeRecordRace("live", t0);
    await history.maybeRecordRace("live", t0 + 30_000); // throttled
    vi.setSystemTime(t0 + 61_000);
    await tracker.recordSnapshot("m", [g("a", 10), g("b", 20)], "live");
    await history.maybeRecordRace("live", t0 + 61_000);
    vi.setSystemTime(t0 + 122_000);
    await tracker.recordSnapshot("m", [g("a", 30), g("b", 20)], "live");
    await history.maybeRecordRace("live", t0 + 122_000);
    const rows = await all(db, "SELECT rank1_uuid, rank2_uuid, rank3_uuid FROM gift_race_snapshots ORDER BY at");
    expect(rows).toEqual([
      { rank1_uuid: "a", rank2_uuid: "b", rank3_uuid: null },
      { rank1_uuid: "b", rank2_uuid: "a", rank3_uuid: null },
      { rank1_uuid: "a", rank2_uuid: "b", rank3_uuid: null },
    ]);
    expect(await history.leadChangesFor("live")).toBe(2);
    expect(await history.leadChangesFor("unknown")).toBe(0);

    await exec(db, "INSERT INTO gift_race_snapshots (slug, at, rank1_uuid, rank1_gold) VALUES ('old', ?, 'z', 1)", [
      t0 - 61 * 24 * 3600_000,
    ]);
    await history.maybeRecordRace("live", t0 + 4 * 3600_000); // writes and prunes
    expect(await all(db, "SELECT slug FROM gift_race_snapshots WHERE slug = 'old'")).toHaveLength(0);
  });
});

describe("recentSessions", () => {
  it("lists finished lives newest first with metadata, skipping live and non-allowed members", async () => {
    const { tracker, history, db } = await load();
    const t = Date.parse("2026-11-05T10:00:00+07:00");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t);
    await tracker.recordSnapshot("m", [g("a", 10), g("b", 5)], "old");
    await history.upsertLiveMeta({
      slug: "old",
      streamerUuid: "m",
      title: "Judul",
      imageUrl: "",
      startedAt: t,
      viewCount: 1,
    });
    await history.markLiveEnded("old", "m", t + 3600_000);
    vi.setSystemTime(t + 7200_000);
    await tracker.recordSnapshot("m", [g("a", 40), g("b", 5)], "new");
    vi.setSystemTime(t + 9000_000);
    await tracker.recordSnapshot("x", [g("a", 1)], "other");
    await exec(db, "INSERT INTO idn_live (user_id, slug) VALUES ('m', 'new')");

    const open = await history.recentSessions(5, { allowed: new Set(["m"]) });
    expect(open.map((e) => e.slug)).toEqual(["old"]); // "new" is still live, "other" is not allowed
    expect(open[0]).toMatchObject({ title: "Judul", startedAt: t, endedAt: t + 3600_000 });
    expect(open[0].gifters.map((x) => x.gold)).toEqual([10, 5]);

    await exec(db, "DELETE FROM idn_live");
    const done = await history.recentSessions(1, { streamerUuid: "m" });
    expect(done.map((e) => e.slug)).toEqual(["new"]);
    expect(done[0].title).toBeNull();
    expect(done[0].gifters[0].gold).toBe(30); // 40 minus the 10 already held when the live began
  });
});
