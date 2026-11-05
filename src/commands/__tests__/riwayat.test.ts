import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeMemberUuids: vi.fn(() => new Set(["m"])),
  finishedSessions: vi.fn(),
  firstTrackedDay: vi.fn(),
  knownStreamers: vi.fn(async () => [{ uuid: "m", username: "jkt48_aralie", name: "Aralie" }]),
  recentSessions: vi.fn(),
}));

vi.mock("@/common/utils/giftTracker", () => mocks);
vi.mock("@/common/utils/giftHistory", () => ({ recentSessions: mocks.recentSessions }));

import { formatDuration, formatEntry, formatWib, run } from "../riwayat";

const entry = {
  slug: "s",
  streamerUuid: "m",
  title: "Ngobrol santai",
  startedAt: Date.parse("2026-11-05T19:30:00+07:00"),
  endedAt: Date.parse("2026-11-05T21:05:00+07:00"),
  gifters: [
    { uuid: "a", name: "Andi", gold: 100, point: 400 },
    { uuid: "b", name: "Budi", gold: 50, point: 200 },
  ],
};

describe("riwayat formatting", () => {
  it("formats WIB time and durations", () => {
    expect(formatWib(entry.startedAt)).toBe("05/11/26 19:30 WIB");
    expect(formatDuration(95 * 60_000)).toBe("1 j 35 m");
    expect(formatDuration(20 * 60_000)).toBe("20 m");
  });

  it("shows title, top gifters, total, count and Rupiah estimate", () => {
    const text = formatEntry(entry, "Aralie");
    expect(text).toContain("**Aralie** — Ngobrol santai");
    expect(text).toContain("🥇 Andi (100)");
    expect(text).toContain("🥈 Budi (50)");
    expect(text).toContain("150 Gold • 2 gifter • ≈ Rp375.000");
    expect(text).toContain("1 j 35 m");
  });

  it("omits title and duration when unknown", () => {
    const text = formatEntry({ ...entry, title: null, endedAt: null }, "Aralie");
    expect(text.startsWith("**Aralie**\n")).toBe(true);
    expect(text).not.toContain(" j ");
  });
});

describe("/riwayat", () => {
  it("defaults to 5 and caps the request at 10", async () => {
    mocks.recentSessions.mockResolvedValue([entry]);
    const editReply = vi.fn();
    const options = (count: number | null) => ({
      getString: vi.fn(() => null),
      getInteger: vi.fn(() => count),
    });
    await run({ interaction: { deferReply: vi.fn(), editReply, options: options(null) } } as never);
    expect(mocks.recentSessions.mock.calls[0][0]).toBe(5);
    await run({ interaction: { deferReply: vi.fn(), editReply, options: options(99) } } as never);
    expect(mocks.recentSessions.mock.calls[1][0]).toBe(10);
    expect(editReply.mock.calls[0][0].embeds[0].data.description).toContain("Ngobrol santai");
  });
});
