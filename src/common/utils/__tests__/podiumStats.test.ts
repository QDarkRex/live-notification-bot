import { describe, expect, it } from "vitest";
import { aggregatePodium } from "../podiumStats";

const live = (slug: string, started_at: number, values: number[]) => ({
  slug,
  streamer_uuid: "member",
  started_at,
  gifters: values.map((gold, i) => ({ uuid: `${slug}-${i}`, name: `${slug}-${i}`, gold, point: gold * 4 })),
});

describe("aggregatePodium", () => {
  it("aggregates by rank across lives, filters short sessions, and picks latest qualifying top three", () => {
    const stats = aggregatePodium([
      live("new", 20, [200, 40, 10]),
      live("old", 10, [100, 60, 20]),
      live("short", 30, [900, 800]),
    ]);
    expect(stats).toEqual([
      {
        uuid: "member",
        lives: 2,
        ranked: [
          { rank: 1, averageGold: 150, minGold: 100, maxGold: 200 },
          { rank: 2, averageGold: 50, minGold: 40, maxGold: 60 },
          { rank: 3, averageGold: 15, minGold: 10, maxGold: 20 },
        ],
        latest: [
          { uuid: "new-0", name: "new-0", gold: 200, point: 800 },
          { uuid: "new-1", name: "new-1", gold: 40, point: 160 },
          { uuid: "new-2", name: "new-2", gold: 10, point: 40 },
        ],
      },
    ]);
  });

  it("returns empty stats for empty or exclusively ineligible sessions", () => {
    expect(aggregatePodium([])).toEqual([]);
    expect(aggregatePodium([live("short", 1, [9, 8])])).toEqual([]);
  });
});
