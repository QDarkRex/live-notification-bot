import { type LiveMember, LoveLetterManager } from "@/common/utils/idnLoveLetter";
import axios from "axios";
import type { Client } from "discord.js";

/**
 * Watches who is live on IDN and keeps a love-letter watcher open for each
 * JKT48 member, so the end-of-stream love letters are captured into SQLite.
 * Recall them with the /loveletter command. This does NOT log chat.
 */

interface LiveResult {
  slug: string;
  creator: { uuid: string; username: string; name: string };
}

async function fetchLiveMembers(): Promise<LiveMember[]> {
  try {
    const res = await axios.post<{ data: { searchLivestream: { result: LiveResult[] } } }>(
      "https://api.idn.app/graphql",
      {
        query: `query SearchLivestream {
          searchLivestream(query: "", limit: 100) {
            result { slug creator { uuid username name } }
          }
        }`,
      },
    );
    const result = res.data?.data?.searchLivestream?.result ?? [];
    return result
      .filter(
        (s) =>
          s.creator.username.startsWith("jkt48_") ||
          (s.creator.username.startsWith("jkt48-") && s.creator.name.endsWith("JKT48")),
      )
      .map((s) => ({
        uuid: s.creator.uuid,
        username: s.creator.username,
        name: s.creator.name,
        slug: s.slug,
      }));
  } catch {
    console.error("[loveletter] failed to fetch live members");
    return [];
  }
}

const manager = new LoveLetterManager();

async function tick() {
  const live = await fetchLiveMembers();
  manager.sync(live);
}

export default function (_client: Client) {
  tick();
  setInterval(tick, 30_000);
}
