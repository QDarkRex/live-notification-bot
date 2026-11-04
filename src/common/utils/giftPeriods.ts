/**
 * IDN's per-streamer gift ranking (`/api/v1/gift/livestream/top-rank`) is a
 * running total that IDN resets once a day — it is NOT per live session. A
 * live that crosses midnight therefore shows only the post-midnight gifts at
 * the end, and anything that just overwrites the latest snapshot loses the
 * rest. We keep each reset period as its own record and sum across them.
 *
 * A new period needs BOTH a new WIB day (IDN resets at 00:00 WIB — seen in the
 * logs on 2026-11-04, every member reset at 00:00:51) AND evidence in the data
 * that the totals went down. The data check alone misfires: IDN's reply is
 * capped at ~50 gifters, small gifters drop in and out of it, and on 2026-11-03
 * that opened ~20 false periods in one hour for a busy room (each re-counting
 * the whole day). The day check alone could double-count if our clock and
 * IDN's disagree around midnight.
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

/**
 * True when `next` (IDN's current reply) starts a new period after the stored
 * one (`prev`: uuid -> gold, first seen on `prevDay`). `today` is the WIB date now.
 */
export function isNewPeriod(prev: Map<string, number>, next: GifterTotal[], prevDay: string, today: string): boolean {
  if (prevDay >= today) return false;
  let nextSum = 0;
  for (const gifter of next) {
    nextSum += gifter.gold;
    const before = prev.get(gifter.uuid);
    if (before !== undefined && gifter.gold < before) return true;
  }
  // The reply only holds the top ~50, so compare it with our same number of
  // largest totals: that sum can only grow within a period.
  const largest = [...prev.values()].sort((a, b) => b - a).slice(0, next.length);
  return nextSum < largest.reduce((sum, gold) => sum + gold, 0);
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
