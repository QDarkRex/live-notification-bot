import { describe, expect, it } from "vitest";
import { aggregateOverall, aggregateTop3Counts, countLeadChanges } from "../podiumStats";

const session = (slug: string, streamer_uuid: string, golds: [string, number][]) => ({
  slug,
  streamer_uuid,
  started_at: 1,
  gifters: golds.map(([uuid, gold]) => ({ uuid, name: uuid.toUpperCase(), gold, point: gold })),
});

describe("aggregateOverall", () => {
  it("ranks members by total Gold with lives and average, ignoring empty sessions", () => {
    const stats = aggregateOverall([
      session("a1", "a", [
        ["x", 100],
        ["y", 50],
      ]),
      session("a2", "a", [["x", 50]]),
      session("b1", "b", [["x", 400]]),
      session("b2", "b", []),
    ]);
    expect(stats).toEqual([
      { uuid: "b", lives: 1, totalGold: 400, averageGold: 400 },
      { uuid: "a", lives: 2, totalGold: 200, averageGold: 100 },
    ]);
    expect(aggregateOverall([])).toEqual([]);
  });
});

describe("aggregateTop3Counts", () => {
  it("counts top-3 finishes per supporter and orders by count, firsts then gold", () => {
    const stats = aggregateTop3Counts([
      session("s1", "m", [
        ["x", 100],
        ["y", 90],
        ["z", 80],
        ["w", 70],
      ]),
      session("s2", "m", [
        ["y", 300],
        ["x", 200],
        ["w", 100],
        ["z", 50],
      ]),
      session("s3", "m", [
        ["z", 5],
        ["w", 4],
      ]), // fewer than three gifters: ignored
    ]);
    expect(stats.map((s) => [s.uuid, s.top3, s.firsts, s.seconds, s.thirds])).toEqual([
      ["y", 2, 1, 1, 0],
      ["x", 2, 1, 1, 0],
      ["w", 1, 0, 0, 1],
      ["z", 1, 0, 0, 1],
    ]);
    expect(stats[0].gold).toBe(390);
  });

  it("returns nothing without qualifying sessions", () => {
    expect(aggregateTop3Counts([])).toEqual([]);
  });
});

describe("countLeadChanges", () => {
  it("counts changes of #1, skipping unknown values and repeats", () => {
    expect(countLeadChanges([])).toBe(0);
    expect(countLeadChanges(["a", "a", "a"])).toBe(0);
    expect(countLeadChanges(["a", "b", "b", "a"])).toBe(2);
    expect(countLeadChanges([null, "a", null, "a", "b"])).toBe(1);
  });
});
