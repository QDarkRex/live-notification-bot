import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeMemberUuids: vi.fn(() => new Set(["active", "second"])),
  finishedSessions: vi.fn(),
  firstTrackedDay: vi.fn(async () => "2026-11-03"),
  knownStreamers: vi.fn(),
}));

vi.mock("@/common/utils/giftTracker", () => mocks);

import { run } from "../podium";

function makeInteraction(values: { member?: string | null; periode?: string | null } = {}) {
  const editReply = vi.fn();
  const deferReply = vi.fn();
  return {
    editReply,
    deferReply,
    options: { getString: vi.fn((key: string) => values[key as "member" | "periode"] ?? null) },
  };
}

function session(streamer_uuid: string, started_at: number, golds: number[], prefix = "g") {
  return {
    slug: `${streamer_uuid}-${started_at}`,
    streamer_uuid,
    started_at,
    gifters: golds.map((gold, i) => ({ uuid: `${prefix}${i}`, name: `${prefix}${i}`, gold, point: gold * 4 })),
  };
}

describe("/podium", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-20T12:00:00+07:00"));
    vi.clearAllMocks();
    mocks.activeMemberUuids.mockReturnValue(new Set(["active", "second"]));
    mocks.knownStreamers.mockResolvedValue([
      { uuid: "active", username: "jkt48_aralie", name: "Aralie", fullName: "Abigail Rachel" },
      { uuid: "second", username: "jkt48_michie", name: "Michie", fullName: "Michelle Alexandra" },
      { uuid: "inactive", username: "jkt48_old", name: "Old", fullName: "Old Member" },
    ]);
    mocks.finishedSessions.mockResolvedValue([]);
  });

  it("defers the public reply and uses the rolling 30-day default", async () => {
    const interaction = makeInteraction();
    await run({ interaction } as never);
    expect(interaction.deferReply).toHaveBeenCalledOnce();
    expect(interaction.deferReply).toHaveBeenCalledWith();
    expect(mocks.finishedSessions.mock.calls[0][0]).toBe(Date.now() - 30 * 24 * 3600_000);
  });

  it("uses the 7-day rolling lower bound", async () => {
    await run({ interaction: makeInteraction({ periode: "7" }) } as never);
    expect(mocks.finishedSessions.mock.calls[0][0]).toBe(Date.now() - 7 * 24 * 3600_000);
  });

  it("limits event sessions to the inclusive WIB end date and current time", async () => {
    vi.setSystemTime(Date.parse("2027-01-02T12:00:00+07:00"));
    mocks.finishedSessions.mockResolvedValue([
      session("active", Date.parse("2026-12-31T23:59:59+07:00"), [10, 8, 4]),
      session("active", Date.parse("2027-01-01T00:00:00+07:00"), [100, 80, 40]),
      session("active", Date.parse("2027-01-03T00:00:00+07:00"), [100, 80, 40]),
    ]);
    const interaction = makeInteraction({ periode: "event", member: "Aralie" });
    await run({ interaction } as never);
    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain("25.000");
    expect(embed.data.description).toContain("**1 live**");
    expect(embed.data.description).toContain("**#2**");
    expect(embed.data.description).toContain("**#3**");
    expect(embed.data.description).not.toContain("200 Gold");
    expect(embed.data.footer.text).toContain("2026-11-03–2026-12-31 WIB");
  });

  it("filters inactive members and matches the optional member using supporter matching", async () => {
    mocks.finishedSessions.mockResolvedValue([
      session("active", Date.now() - 1_000, [100, 60, 30]),
      session("active", Date.now() + 1_000, [800, 700, 600]),
      session("inactive", Date.now() - 1_000, [900, 800, 700]),
    ]);
    const interaction = makeInteraction({ member: "jkt48_aralie" });
    await run({ interaction } as never);
    const embed = interaction.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain("#1");
    expect(embed.data.description).toContain("Podium live terbaru:");
    expect(embed.data.description).toContain("100");
    expect(embed.data.description).not.toContain("900");
    expect(embed.data.description).not.toContain("800");
    expect(mocks.finishedSessions.mock.calls[0][0]).toBeLessThan(Date.now());
  });

  it("shows at most 15 active members in descending average #1 rank", async () => {
    const uuids = Array.from({ length: 16 }, (_, i) => `member-${i}`);
    mocks.activeMemberUuids.mockReturnValue(new Set(uuids));
    mocks.knownStreamers.mockResolvedValue(uuids.map((uuid, i) => ({ uuid, username: uuid, name: `Member ${i}` })));
    mocks.finishedSessions.mockResolvedValue(
      uuids.map((uuid, i) => session(uuid, Date.now() - i - 1, [1000 - i, 20, 10])),
    );
    const interaction = makeInteraction();
    await run({ interaction } as never);
    const description = interaction.editReply.mock.calls[0][0].embeds[0].data.description as string;
    expect(description.match(/Gold\/live/g)).toHaveLength(15);
    expect(description).toContain("Member 0");
    expect(description).not.toContain("Member 15");
  });
});
