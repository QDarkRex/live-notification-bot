import { describe, expect, it } from "vitest";
import { type GifterTotal, isNewPeriod, sessionTotals, wibDate, wibMidnight } from "../giftPeriods";

const g = (uuid: string, gold: number, name = uuid): GifterTotal => ({ uuid, name, gold, point: gold * 4 });
const prev = (...rows: GifterTotal[]) => new Map(rows.map((r) => [r.uuid, r.gold]));

describe("wibDate", () => {
  it("uses the Jakarta calendar day", () => {
    expect(wibDate(Date.parse("2026-11-03T16:59:59Z"))).toBe("2026-11-03"); // 23:59:59 WIB
    expect(wibDate(Date.parse("2026-11-03T17:00:00Z"))).toBe("2026-11-04"); // 00:00 WIB
  });
});

describe("wibMidnight", () => {
  it("returns 00:00 WIB of the containing WIB day", () => {
    expect(wibMidnight(Date.parse("2026-11-04T16:59:59Z"))).toBe(Date.parse("2026-11-03T17:00:00Z"));
    expect(wibMidnight(Date.parse("2026-11-04T17:00:00Z"))).toBe(Date.parse("2026-11-04T17:00:00Z"));
  });
});

describe("isNewPeriod", () => {
  const Y = "2026-11-03";
  const T = "2026-11-04";
  // 2026-11-04 00:00 WIB = 2026-11-03T17:00Z
  const at = (hhmmss: string) => Date.parse(`2026-11-03T${hhmmss}Z`);
  const wib = (hhmmss: string) => Date.parse(`2026-11-04T${hhmmss}Z`) - 7 * 3600_000; // WIB clock time on the T day
  const lastNight = at("16:59:50"); // 23:59:50 WIB on Y
  const inWindow = wib("00:00:24");
  const afterCutoff = wib("00:06:00");

  it("keeps growing totals and newly joined gifters in the same period", () => {
    expect(
      isNewPeriod(
        prev(g("a", 100), g("b", 50)),
        [g("a", 120), g("b", 50), g("c", 5)],
        Y,
        lastNight,
        lastNight + 10_000,
      ),
    ).toBe(false);
  });

  it("detects IDN's midnight reset when a gifter's total drops (inside the grace window)", () => {
    expect(isNewPeriod(prev(g("a", 419), g("b", 208)), [g("a", 10), g("b", 208)], Y, lastNight, inWindow)).toBe(true);
  });

  it("detects a reset even when the post-midnight gifters are all new", () => {
    expect(isNewPeriod(prev(g("a", 419), g("b", 208)), [g("c", 30)], Y, lastNight, inWindow)).toBe(true);
  });

  it("opens nothing for the very first snapshot", () => {
    expect(isNewPeriod(new Map(), [g("a", 1)], Y, lastNight, inWindow)).toBe(false);
  });

  it("ignores small gifters falling out of IDN's capped (~50) reply", () => {
    const stored = prev(g("a", 600), g("b", 300), g("tiny1", 1), g("tiny2", 1));
    expect(isNewPeriod(stored, [g("a", 610), g("b", 300), g("tiny2", 1)], Y, lastNight, inWindow)).toBe(false);
  });

  it("never opens a second period on the same WIB day", () => {
    expect(isNewPeriod(prev(g("a", 419)), [g("a", 10)], T, wib("00:00:30"), wib("12:00:00"))).toBe(false);
  });

  it("stays in the old period inside the grace window without a drop (reply may be stale)", () => {
    expect(isNewPeriod(prev(g("a", 151)), [g("x", 200)], Y, lastNight, inWindow)).toBe(false);
  });

  it("opens a new period after the cutoff without a drop (undercount case)", () => {
    expect(isNewPeriod(prev(g("a", 10)), [g("a", 20)], Y, lastNight, afterCutoff)).toBe(true);
  });

  it("opens a new period for the first live of a new day even without a drop", () => {
    expect(isNewPeriod(prev(g("a", 10)), [g("a", 20)], Y, at("14:00:00"), wib("09:00:00"))).toBe(true);
  });

  it("does not reopen when the stored period was already written after the cutoff", () => {
    // Period of day Y last written at 00:07 (only possible if it was kept alive); not before the cutoff.
    expect(isNewPeriod(prev(g("a", 10)), [g("a", 20)], Y, wib("00:07:00"), wib("00:08:00"))).toBe(false);
  });
});

describe("sessionTotals", () => {
  it("sums a live that crosses midnight (before + after the reset)", () => {
    // Aralie lives 22:00 -> 01:00. Before midnight: a=300, b=100. After the reset: a=50, c=80.
    const rows = [g("a", 300), g("b", 100), g("a", 50), g("c", 80)];
    expect(sessionTotals(rows, new Map()).map((x) => [x.uuid, x.gold])).toEqual([
      ["a", 350],
      ["b", 100],
      ["c", 80],
    ]);
  });

  it("excludes gifts from an earlier live the same day", () => {
    // Morning live left a=200 in today's ranking; the evening live adds 40 to a and 10 from b.
    const rows = [g("a", 240), g("b", 10)];
    const baseline = new Map([["a", g("a", 200)]]);
    expect(sessionTotals(rows, baseline).map((x) => [x.uuid, x.gold])).toEqual([
      ["a", 40],
      ["b", 10],
    ]);
  });

  it("drops gifters who gave nothing this session and keeps the latest name", () => {
    const rows = [g("a", 200, "old"), g("b", 5), g("b", 7, "renamed")];
    const baseline = new Map([["a", g("a", 200)]]);
    expect(sessionTotals(rows, baseline)).toEqual([{ uuid: "b", name: "renamed", gold: 12, point: 48 }]);
  });
});
