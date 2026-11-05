import type { FinishedSession, GifterTotal } from "@/common/utils/giftTracker";

export interface PodiumStat {
  uuid: string;
  lives: number;
  ranked: { rank: number; averageGold: number; minGold: number; maxGold: number }[];
  latest: GifterTotal[];
}

/** Aggregate Gold by finishing position across sessions with at least three gifters. */
export function aggregatePodium(sessions: FinishedSession[]): PodiumStat[] {
  const byMember = new Map<string, FinishedSession[]>();
  for (const session of sessions) {
    if (session.gifters.length < 3) continue;
    byMember.set(session.streamer_uuid, [...(byMember.get(session.streamer_uuid) ?? []), session]);
  }
  return [...byMember]
    .map(([uuid, memberSessions]) => {
      const ranks = [0, 1, 2].map((index) => {
        const values = memberSessions.map((s) => [...s.gifters].sort((a, b) => b.gold - a.gold)[index].gold);
        return {
          rank: index + 1,
          averageGold: values.reduce((a, b) => a + b, 0) / values.length,
          minGold: Math.min(...values),
          maxGold: Math.max(...values),
        };
      });
      const latestSession = memberSessions.reduce((a, b) => (b.started_at > a.started_at ? b : a));
      return {
        uuid,
        lives: memberSessions.length,
        ranked: ranks,
        latest: [...latestSession.gifters].sort((a, b) => b.gold - a.gold).slice(0, 3),
      };
    })
    .sort((a, b) => b.ranked[0].averageGold - a.ranked[0].averageGold);
}

export interface OverallStat {
  uuid: string;
  lives: number;
  totalGold: number;
  averageGold: number;
}

/** Members ranked by total session Gold; sessions with no gifters are ignored. */
export function aggregateOverall(sessions: FinishedSession[]): OverallStat[] {
  const byMember = new Map<string, { lives: number; totalGold: number }>();
  for (const session of sessions) {
    if (session.gifters.length === 0) continue;
    const acc = byMember.get(session.streamer_uuid) ?? { lives: 0, totalGold: 0 };
    acc.lives += 1;
    acc.totalGold += session.gifters.reduce((sum, g) => sum + g.gold, 0);
    byMember.set(session.streamer_uuid, acc);
  }
  return [...byMember]
    .map(([uuid, v]) => ({ uuid, ...v, averageGold: v.totalGold / v.lives }))
    .sort((a, b) => b.totalGold - a.totalGold || a.uuid.localeCompare(b.uuid));
}

export interface Top3Stat {
  uuid: string;
  name: string;
  top3: number;
  firsts: number;
  seconds: number;
  thirds: number;
  gold: number;
}

/** Supporters ranked by how often they finished in a session's top 3 (sessions need 3+ gifters). */
export function aggregateTop3Counts(sessions: FinishedSession[]): Top3Stat[] {
  const byGifter = new Map<string, Top3Stat>();
  for (const session of sessions) {
    if (session.gifters.length < 3) continue;
    const podium = [...session.gifters].sort(
      (a, b) => b.gold - a.gold || b.point - a.point || a.name.localeCompare(b.name),
    );
    podium.slice(0, 3).forEach((g, index) => {
      const acc = byGifter.get(g.uuid) ?? {
        uuid: g.uuid,
        name: g.name,
        top3: 0,
        firsts: 0,
        seconds: 0,
        thirds: 0,
        gold: 0,
      };
      acc.top3 += 1;
      if (index === 0) acc.firsts += 1;
      else if (index === 1) acc.seconds += 1;
      else acc.thirds += 1;
      acc.gold += g.gold;
      acc.name = g.name;
      byGifter.set(g.uuid, acc);
    });
  }
  return [...byGifter.values()].sort(
    (a, b) => b.top3 - a.top3 || b.firsts - a.firsts || b.gold - a.gold || a.name.localeCompare(b.name),
  );
}

/** Number of times the leader changed between consecutive snapshots (unknown leaders are skipped). */
export function countLeadChanges(leaders: (string | null)[]): number {
  let changes = 0;
  let current: string | null = null;
  for (const leader of leaders) {
    if (!leader) continue;
    if (current !== null && leader !== current) changes += 1;
    current = leader;
  }
  return changes;
}
