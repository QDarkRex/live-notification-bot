import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatGiftEvent } from "../giftChat";

const originalEnv = { ...process.env };
let testDir: string | undefined;
let closeDatabase: (() => Promise<void>) | undefined;

async function load() {
  testDir = mkdtempSync(path.join(tmpdir(), "gift-tracker-"));
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
  const chat = await import("../giftChat");
  return { tracker, chat, db };
}

afterEach(async () => {
  vi.useRealTimers();
  if (closeDatabase) await closeDatabase();
  closeDatabase = undefined;
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

const S = "streamer";
// Clock times in WIB: day Y = 2026-11-04, day T = 2026-11-05.
const wib = (day: string, hhmmss: string) => Date.parse(`${day}T${hhmmss}+07:00`);
const g = (uuid: string, gold: number) => ({ uuid, name: uuid, gold, point: gold * 4 });

function setNow(ms: number) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(ms);
}

type TotalRow = { period_id: number; gifter_uuid: string; total_gold: number; total_point: number };

function rows(db: any): Promise<TotalRow[]> {
  return new Promise((resolve, reject) =>
    db.all(
      "SELECT period_id, gifter_uuid, total_gold, total_point FROM gift_period_totals ORDER BY period_id, gifter_uuid",
      (err: Error | null, r: any) => (err ? reject(err) : resolve(r)),
    ),
  );
}

function periods(db: any): Promise<{ id: number; day: string }[]> {
  return new Promise((resolve, reject) =>
    db.all("SELECT id, day FROM gift_periods ORDER BY id", (err: Error | null, r: any) =>
      err ? reject(err) : resolve(r),
    ),
  );
}

function chatEvent(msgid: string, at: number, gifter: string, gold: number): ChatGiftEvent {
  return {
    streamer_uuid: S,
    slug: "live",
    msgid,
    event_at: at,
    received_at: at,
    day: new Date(at + 7 * 3600_000).toISOString().slice(0, 10),
    gifter_uuid: gifter,
    gifter_name: gifter,
    gold,
    point: gold * 4,
  };
}

const goldOf = (r: TotalRow[], period: number) =>
  Object.fromEntries(r.filter((x) => x.period_id === period).map((x) => [x.gifter_uuid, x.total_gold]));

describe("giftTracker reset rule", () => {
  it("does not double count a new-day gifter once the grace window has passed", async () => {
    const { tracker, db } = await load();
    setNow(wib("2026-11-04", "23:59:50"));
    await tracker.recordSnapshot(S, [g("A", 151)]);
    setNow(wib("2026-11-05", "00:06:00"));
    await tracker.recordSnapshot(S, [g("X", 200)]);
    setNow(wib("2026-11-05", "00:06:15"));
    await tracker.recordSnapshot(S, [g("X", 200), g("Y", 5)]);
    const r = await rows(db);
    expect(goldOf(r, 1)).toEqual({ A: 151 });
    expect(goldOf(r, 2)).toEqual({ X: 200, Y: 5 });
    expect(await periods(db)).toHaveLength(2);
  });

  it("does not undercount a gifter whose post-reset total already exceeds the old one", async () => {
    const { tracker, db } = await load();
    setNow(wib("2026-11-04", "23:59:50"));
    await tracker.recordSnapshot(S, [g("A", 10)]);
    setNow(wib("2026-11-05", "00:06:00"));
    await tracker.recordSnapshot(S, [g("A", 20)]);
    const r = await rows(db);
    expect(goldOf(r, 1)).toEqual({ A: 10 });
    expect(goldOf(r, 2)).toEqual({ A: 20 });
  });

  it("handles a live crossing midnight: stale reply merges, drop opens the new period", async () => {
    const { tracker, db } = await load();
    setNow(wib("2026-11-04", "23:59:50"));
    await tracker.recordSnapshot(S, [g("A", 100), g("B", 50)], "live");
    setNow(wib("2026-11-05", "00:00:09"));
    await tracker.recordSnapshot(S, [g("A", 100), g("B", 50)], "live"); // stale
    expect(await periods(db)).toHaveLength(1);
    setNow(wib("2026-11-05", "00:00:24"));
    await tracker.recordSnapshot(S, [g("A", 7)], "live"); // reset, A dropped
    const r = await rows(db);
    expect(goldOf(r, 1)).toEqual({ A: 100, B: 50 });
    expect(goldOf(r, 2)).toEqual({ A: 7 });
    const lb = await tracker.sessionLeaderboard("live");
    expect(lb?.map((x) => [x.uuid, x.gold])).toEqual([
      ["A", 107],
      ["B", 50],
    ]);
  });

  it("keeps a reply inside the window without a drop in the old period", async () => {
    const { tracker, db } = await load();
    setNow(wib("2026-11-04", "23:59:50"));
    await tracker.recordSnapshot(S, [g("A", 100)]);
    setNow(wib("2026-11-05", "00:02:00"));
    await tracker.recordSnapshot(S, [g("A", 110)]);
    expect(await periods(db)).toHaveLength(1);
    expect(goldOf(await rows(db), 1)).toEqual({ A: 110 });
  });

  it("opens a new period for the first live of a new day at 09:00 even without a drop", async () => {
    const { tracker, db } = await load();
    setNow(wib("2026-11-04", "21:00:00"));
    await tracker.recordSnapshot(S, [g("A", 10)]);
    setNow(wib("2026-11-05", "09:00:00"));
    await tracker.recordSnapshot(S, [g("A", 20)], "morning");
    expect(await periods(db)).toHaveLength(2);
    expect(goldOf(await rows(db), 2)).toEqual({ A: 20 });
  });

  it("never opens a second period on the same day", async () => {
    const { tracker, db } = await load();
    setNow(wib("2026-11-05", "09:00:00"));
    await tracker.recordSnapshot(S, [g("A", 500)]);
    setNow(wib("2026-11-05", "15:00:00"));
    await tracker.recordSnapshot(S, [g("A", 5)]);
    expect(await periods(db)).toHaveLength(1);
  });
});

describe("giftTracker chat reconciliation at reset", () => {
  it("raises the previous period to the chat per-gifter totals (MAX), inserting missing gifters", async () => {
    const { tracker, chat, db } = await load();
    setNow(wib("2026-11-04", "23:59:00"));
    await tracker.recordSnapshot(S, [g("A", 100), g("B", 50), g("C", 30)]);
    // Chat saw A=100+279 (late gift missed by poll), B=40 (below poll), D=3 (poll never listed).
    await chat.recordChatGift(chatEvent("m1", wib("2026-11-04", "23:30:00"), "A", 100));
    await chat.recordChatGift(chatEvent("m2", wib("2026-11-04", "23:59:28"), "A", 279));
    await chat.recordChatGift(chatEvent("m3", wib("2026-11-04", "23:40:00"), "B", 40));
    await chat.recordChatGift(chatEvent("m4", wib("2026-11-04", "23:59:40"), "D", 3));
    await chat.recordChatGift(chatEvent("m5", wib("2026-11-05", "00:00:05"), "A", 9)); // next day: not in P
    setNow(wib("2026-11-05", "00:00:24"));
    await tracker.recordSnapshot(S, [g("A", 9)]);
    const r = await rows(db);
    expect(goldOf(r, 1)).toEqual({ A: 379, B: 50, C: 30, D: 3 });
    expect(goldOf(r, 2)).toEqual({ A: 9 });
  });

  it("is idempotent: replaying snapshots never inflates the closed period", async () => {
    const { tracker, chat, db } = await load();
    setNow(wib("2026-11-04", "23:59:00"));
    await tracker.recordSnapshot(S, [g("A", 100)]);
    await chat.recordChatGift(chatEvent("m1", wib("2026-11-04", "23:59:28"), "A", 120));
    setNow(wib("2026-11-05", "00:00:24"));
    await tracker.recordSnapshot(S, [g("A", 5)]);
    await tracker.recordSnapshot(S, [g("A", 5)]);
    setNow(wib("2026-11-05", "00:10:00"));
    await tracker.recordSnapshot(S, [g("A", 6)]);
    const r = await rows(db);
    expect(goldOf(r, 1)).toEqual({ A: 120 });
    expect(goldOf(r, 2)).toEqual({ A: 6 });
    expect(await periods(db)).toHaveLength(2);
  });
});
