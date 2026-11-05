/**
 * IDN's per-streamer gift ranking (`/api/v1/gift/livestream/top-rank`) is a
 * DAILY running total that resets at 00:00 WIB (seen in the logs: 00:00:51 and
 * 00:00:24 on two nights). It is NOT per live session. A live that crosses
 * midnight therefore shows only the post-midnight gifts at the end, and
 * anything that just overwrites the latest snapshot loses the rest. We keep
 * each reset period as its own record and sum across them.
 *
 * A new period needs a new WIB day AND either
 *  - evidence in the data that the totals went down (IDN's reply is capped at
 *    ~50 gifters and small gifters drop in and out, so a data check alone
 *    misfired on 2026-11-03 and opened ~20 false periods; the day gate stops
 *    that), or
 *  - the clock: the owner approved treating the API as certainly reset
 *    `RESET_GRACE_MS` after 00:00 WIB. The first snapshot after that cutoff for
 *    a period not written since before it opens a new period even without a
 *    drop (a gifter whose post-reset total is already above yesterday's would
 *    otherwise be MAX-merged and under-counted, and a fully new gifter list
 *    would be merged into yesterday and counted twice later).
 * Inside the grace window replies can still be stale for ~10-25 s, so only the
 * drop rule applies there.
 */

export interface GifterTotal {
  uuid: string;
  name: string;
  gold: number;
  point: number;
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** WIB calendar date (YYYY-MM-DD) of a timestamp. */
export function wibDate(ms: number): string {
  return new Date(ms + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** After this long past 00:00 WIB the top-rank API has certainly reset. */
export const RESET_GRACE_MS = 5 * 60 * 1000;

/** Timestamp of 00:00 WIB of the WIB day containing `ms`. */
export function wibMidnight(ms: number): number {
  return Math.floor((ms + WIB_OFFSET_MS) / DAY_MS) * DAY_MS - WIB_OFFSET_MS;
}

/**
 * True when `next` (IDN's current reply, received at `now`) starts a new period
 * after the stored one (`prev`: uuid -> gold, first seen on `prevDay`, last
 * written at `prevUpdatedAt` ms).
 */
export function isNewPeriod(
  prev: Map<string, number>,
  next: GifterTotal[],
  prevDay: string,
  prevUpdatedAt: number,
  now: number,
): boolean {
  if (prevDay >= wibDate(now)) return false;
  const cutoff = wibMidnight(now) + RESET_GRACE_MS;
  if (prevUpdatedAt < cutoff && now >= cutoff) return true;
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
