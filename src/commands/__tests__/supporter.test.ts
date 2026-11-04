import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeMemberUuids: vi.fn(() => new Set(["active-uuid"])),
  knownStreamers: vi.fn(),
  streamerSupporters: vi.fn(),
  streamerTotals: vi.fn(),
  firstTrackedDay: vi.fn(async () => "2026-11-03"),
}));

vi.mock("@/common/utils/giftTracker", () => mocks);

import { run } from "../supporter";

function interaction(query: string | null) {
  const editReply = vi.fn();
  return {
    editReply,
    deferReply: vi.fn(),
    options: { getString: vi.fn(() => query) },
  };
}

describe("/supporter member filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activeMemberUuids.mockReturnValue(new Set(["active-uuid"]));
    mocks.knownStreamers.mockResolvedValue([
      { uuid: "active-uuid", username: "jkt48_aralie", name: "Aralie", fullName: "Abigail Rachel" },
      { uuid: "official-uuid", username: "jkt48_official", name: "Official", fullName: "JKT48 Official" },
      { uuid: "graduate-uuid", username: "jkt48_graduate", name: "Graduate", fullName: "Former Member" },
    ]);
    mocks.streamerTotals.mockResolvedValue([
      ...Array.from({ length: 25 }, (_, i) => ({
        streamer_uuid: `nonmember-${i}`,
        gold: 900000 - i,
        supporters: 99,
      })),
      { streamer_uuid: "official-uuid", gold: 800000, supporters: 88 },
      { streamer_uuid: "graduate-uuid", gold: 700000, supporters: 77 },
      { streamer_uuid: "active-uuid", gold: 100, supporters: 1 },
    ]);
    mocks.streamerSupporters.mockResolvedValue([]);
  });

  it("excludes official and graduate totals before rendering the ranked list", async () => {
    const reply = interaction(null);
    await run({ interaction: reply } as never);
    const embed = reply.editReply.mock.calls[0][0].embeds[0];
    expect(embed.data.description).toContain("Aralie");
    expect(embed.data.description).not.toContain("Official");
    expect(embed.data.description).not.toContain("Graduate");
  });

  it("does not allow searching for official or graduate accounts", async () => {
    for (const query of ["official", "graduate"]) {
      const reply = interaction(query);
      await run({ interaction: reply } as never);
      expect(reply.editReply.mock.calls[0][0].content).toContain("tidak ditemukan");
    }
    expect(mocks.streamerSupporters).not.toHaveBeenCalled();
  });
});
