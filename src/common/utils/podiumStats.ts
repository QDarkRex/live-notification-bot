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
