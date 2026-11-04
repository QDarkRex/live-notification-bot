import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatGiftEvent } from "../giftChat";

const originalEnv = { ...process.env };
let testDir: string | undefined;
let closeDatabase: (() => Promise<void>) | undefined;

async function loadGiftChat(databasePath: string) {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DB_PATH: databasePath,
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
  return { giftChat: await import("../giftChat"), db };
}

function event(overrides: Partial<ChatGiftEvent> = {}): ChatGiftEvent {
  const eventAt = Date.parse("2026-11-04T12:11:03.331Z");
  return {
    streamer_uuid: "streamer",
    slug: "session-one",
    msgid: "event-1",
    event_at: eventAt,
    received_at: eventAt,
    day: "2026-11-04",
    gifter_uuid: "gifter-1",
    gifter_name: "Gifter 1",
    gold: 11,
    point: 44,
    ...overrides,
  };
}

function eventLine(time: string, msgid: string, gifterUuid: string, gold: number): string {
  return `@time=${time};msgid=${msgid} :IDNOdin!IDNOdin@serverop.idn.app PRIVMSG #arn :${JSON.stringify({
    user: { name: gifterUuid, uuid: gifterUuid },
    gift: { gold, point: gold * 4 },
    room_id: "session-one",
  })}`;
}

afterEach(async () => {
  if (closeDatabase) await closeDatabase();
  closeDatabase = undefined;
  if (testDir) rmSync(testDir, { recursive: true, force: true });
  testDir = undefined;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("gift chat event ledger", () => {
  it("deduplicates replays and restarts, sums exact sessions/days, and keeps more than 50 gifters", async () => {
    testDir = mkdtempSync(path.join(tmpdir(), "gift-chat-ledger-"));
    const databasePath = path.join(testDir, "whitelist.db");
    const first = await loadGiftChat(databasePath);
    const snapshotBefore = await new Promise<{ n: number }>((resolve, reject) =>
      first.db.get("SELECT COUNT(*) AS n FROM gift_period_totals", (err, row) =>
        err ? reject(err) : resolve(row as { n: number }),
      ),
    );
    await new Promise<void>((resolve, reject) =>
      first.db.run(
        "INSERT INTO gift_period_totals (period_id,gifter_uuid,gifter_name,total_gold,total_point) VALUES (999,'poll-gifter','Poll Gifter',123,456)",
        (err) => (err ? reject(err) : resolve()),
      ),
    );
    await new Promise<void>((resolve, reject) =>
      first.db.run(
        "INSERT INTO top_gifts (uuid,rank,name,total_gold,total_point) VALUES ('poll-streamer',1,'Poll Gifter',123,456)",
        (err) => (err ? reject(err) : resolve()),
      ),
    );
    const pollBefore = await new Promise<{ period_id: number; gifter_uuid: string; total_gold: number }[]>(
      (resolve, reject) =>
        first.db.all(
          "SELECT period_id,gifter_uuid,total_gold FROM gift_period_totals ORDER BY period_id,gifter_uuid",
          (err, rows) =>
            err ? reject(err) : resolve(rows as { period_id: number; gifter_uuid: string; total_gold: number }[]),
        ),
    );
    const topBefore = await new Promise<{ uuid: string; total_gold: number }[]>((resolve, reject) =>
      first.db.all("SELECT uuid,total_gold FROM top_gifts ORDER BY uuid", (err, rows) =>
        err ? reject(err) : resolve(rows as { uuid: string; total_gold: number }[]),
      ),
    );

    const duplicate = event();
    const inserted = await Promise.all(Array.from({ length: 8 }, () => first.giftChat.recordChatGift(duplicate)));
    expect(inserted.filter(Boolean)).toHaveLength(1);
    await first.giftChat.recordChatGift(event({ msgid: "event-2", gold: 6, point: 24 }));
    const beforeMidnight = first.giftChat.parseChatGift(
      eventLine("2026-11-04T16:59:59.999Z", "before-midnight", "midnight-gifter", 7),
      { uuid: "streamer", username: "jkt48_example", name: "Example", slug: "session-one" },
      "arn",
      Date.parse("2026-11-04T17:02:00Z"),
    )!;
    const afterMidnight = first.giftChat.parseChatGift(
      eventLine("2026-11-04T17:00:00.000Z", "after-midnight", "midnight-gifter", 9),
      { uuid: "streamer", username: "jkt48_example", name: "Example", slug: "session-one" },
      "arn",
      Date.parse("2026-11-04T17:02:00Z"),
    )!;
    expect(beforeMidnight.day).toBe("2026-11-04");
    expect(afterMidnight.day).toBe("2026-11-05");
    await first.giftChat.recordChatGift(beforeMidnight);
    await first.giftChat.recordChatGift(afterMidnight);
    await first.giftChat.recordChatGift(event({ slug: "session-two", msgid: "other-session", gold: 20, point: 80 }));
    for (let i = 0; i < 55; i++) {
      await first.giftChat.recordChatGift(
        event({ msgid: `supporter-${i}`, gifter_uuid: `gifter-${i}`, gifter_name: `Gifter ${i}` }),
      );
    }
    const sessionOne = await first.giftChat.chatSessionTotals("session-one", "streamer");
    expect(sessionOne).toHaveLength(56);
    expect(sessionOne.find((gifter) => gifter.uuid === "midnight-gifter")).toMatchObject({ gold: 16, point: 64 });
    expect(sessionOne.find((gifter) => gifter.uuid === "gifter-1")).toMatchObject({ gold: 28, point: 112 });
    expect(await first.giftChat.chatSessionTotals("session-two", "streamer")).toEqual([
      { uuid: "gifter-1", name: "Gifter 1", gold: 20, point: 80 },
    ]);
    expect(await first.giftChat.chatDailyTotals("streamer", "2026-11-04")).toHaveLength(56);
    expect(await first.giftChat.chatDailyTotals("streamer", "2026-11-05")).toEqual([
      { uuid: "midnight-gifter", name: "midnight-gifter", gold: 9, point: 36 },
    ]);

    await first.giftChat.noteChatSocketOpen(
      { uuid: "streamer", username: "jkt48_example", name: "Example", slug: "session-one" },
      10,
    );
    await first.giftChat.noteChatAttached(
      { uuid: "streamer", username: "jkt48_example", name: "Example", slug: "session-one" },
      20,
    );
    await first.giftChat.noteUnexpectedChatDisconnect(
      { uuid: "streamer", username: "jkt48_example", name: "Example", slug: "session-one" },
      30,
    );

    await closeDatabase?.();
    closeDatabase = undefined;
    const reopened = await loadGiftChat(databasePath);
    expect(await reopened.giftChat.recordChatGift(duplicate)).toBe(false);
    expect(await reopened.giftChat.recordChatGift(beforeMidnight)).toBe(false);
    expect((await reopened.giftChat.chatSessionTotals("session-one", "streamer")).length).toBe(56);
    expect(
      (await reopened.giftChat.chatSessionTotals("session-one", "streamer")).find(
        (gifter) => gifter.uuid === "midnight-gifter",
      ),
    ).toMatchObject({ gold: 16, point: 64 });
    const snapshotAfter = await new Promise<{ n: number }>((resolve, reject) =>
      reopened.db.get("SELECT COUNT(*) AS n FROM gift_period_totals", (err, row) =>
        err ? reject(err) : resolve(row as { n: number }),
      ),
    );
    expect(snapshotAfter.n).toBe(snapshotBefore.n + 1);
    const pollAfter = await new Promise<{ period_id: number; gifter_uuid: string; total_gold: number }[]>(
      (resolve, reject) =>
        reopened.db.all(
          "SELECT period_id,gifter_uuid,total_gold FROM gift_period_totals ORDER BY period_id,gifter_uuid",
          (err, rows) =>
            err ? reject(err) : resolve(rows as { period_id: number; gifter_uuid: string; total_gold: number }[]),
        ),
    );
    const topAfter = await new Promise<{ uuid: string; total_gold: number }[]>((resolve, reject) =>
      reopened.db.all("SELECT uuid,total_gold FROM top_gifts ORDER BY uuid", (err, rows) =>
        err ? reject(err) : resolve(rows as { uuid: string; total_gold: number }[]),
      ),
    );
    expect(pollAfter).toEqual(pollBefore);
    expect(topAfter).toEqual(topBefore);
    const sessions = await new Promise<{
      first_attached_at: number;
      last_attached_at: number;
      connect_count: number;
      disconnect_count: number;
    }>((resolve, reject) =>
      reopened.db.get(
        "SELECT first_attached_at,last_attached_at,connect_count,disconnect_count FROM gift_chat_sessions WHERE streamer_uuid=? AND slug=?",
        ["streamer", "session-one"],
        (err, row) =>
          err
            ? reject(err)
            : resolve(
                row as {
                  first_attached_at: number;
                  last_attached_at: number;
                  connect_count: number;
                  disconnect_count: number;
                },
              ),
      ),
    );
    expect(sessions).toEqual({ first_attached_at: 20, last_attached_at: 20, connect_count: 1, disconnect_count: 1 });
    await reopened.giftChat.noteChatSocketOpen(
      { uuid: "streamer", username: "jkt48_example", name: "Example", slug: "session-one" },
      40,
    );
    await reopened.giftChat.noteChatAttached(
      { uuid: "streamer", username: "jkt48_example", name: "Example", slug: "session-one" },
      50,
    );
    const sessionAfterReconnect = await new Promise<{
      first_attached_at: number;
      last_attached_at: number;
      connect_count: number;
    }>((resolve, reject) =>
      reopened.db.get(
        "SELECT first_attached_at,last_attached_at,connect_count FROM gift_chat_sessions WHERE streamer_uuid=? AND slug=?",
        ["streamer", "session-one"],
        (err, row) =>
          err
            ? reject(err)
            : resolve(row as { first_attached_at: number; last_attached_at: number; connect_count: number }),
      ),
    );
    expect(sessionAfterReconnect).toEqual({ first_attached_at: 20, last_attached_at: 50, connect_count: 2 });
  });
});
