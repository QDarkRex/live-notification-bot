/**
 * IDN's per-streamer gift ranking (`/api/v1/gift/livestream/top-rank`) is a
 * running total that IDN resets once a day — it is NOT per live session. A
 * live that crosses midnight therefore shows only the post-midnight gifts at
 * the end, and anything that just overwrites the latest snapshot loses the
 * rest. We keep each reset period as its own record and sum across them.
 *
 * Reset detection is purely data-driven: within one period every gifter's
 * total only grows, so any drop means IDN started a new period. We deliberately
 * don't also cut periods on the calendar — if IDN's reset time ever differs
 * from our clock, a calendar cut would double-count a whole day, whereas a
 * missed cut (only possible after bot downtime) merely undercounts.
 */

export interface GifterTotal {
  uuid: string;
  name: string;
  gold: number;
  point: number;
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** WIB calendar date (YYYY-MM-DD) of a timestamp. */
export function wibDate(ms: number): string {
  return new Date(ms + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** True when `next` cannot belong to the same period as `prev` (uuid -> gold). */
export function isNewPeriod(prev: Map<string, number>, next: GifterTotal[]): boolean {
  let prevSum = 0;
  for (const gold of prev.values()) prevSum += gold;
  let nextSum = 0;
  for (const gifter of next) {
    nextSum += gifter.gold;
    const before = prev.get(gifter.uuid);
    if (before !== undefined && gifter.gold < before) return true;
  }
  return nextSum < prevSum;
}

/**
 * Per-gifter totals for one live session: everything recorded in the periods
 * the session touched, minus what the first period already held before the
 * session started (an earlier live the same day). Sorted like IDN's ranking.
 */
export function sessionTotals(periodRows: GifterTotal[], baseline: Map<string, GifterTotal>): GifterTotal[] {
  const byGifter = new Map<string, GifterTotal>();
  for (const row of periodRows) {
    const acc = byGifter.get(row.uuid);
    if (acc) {
      acc.gold += row.gold;
      acc.point += row.point;
      acc.name = row.name;
    } else {
      byGifter.set(row.uuid, { ...row });
    }
  }
  for (const [uuid, before] of baseline) {
    const acc = byGifter.get(uuid);
    if (acc) {
      acc.gold -= before.gold;
      acc.point -= before.point;
    }
  }
  return rankGifters([...byGifter.values()].filter((g) => g.gold > 0 || g.point > 0));
}

export function rankGifters(gifters: GifterTotal[]): GifterTotal[] {
  return [...gifters].sort((a, b) => b.gold - a.gold || b.point - a.point || a.name.localeCompare(b.name));
}
