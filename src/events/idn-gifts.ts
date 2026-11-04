import {
  ingestChatGift,
  noteChatAttached,
  noteChatSocketOpen,
  noteUnexpectedChatDisconnect,
} from "@/common/utils/giftChat";
import { IdnChatManager, type LiveMember } from "@/common/utils/idnChat";
import axios from "axios";
import type { Client } from "discord.js";

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
        (stream) =>
          stream.creator.username.startsWith("jkt48_") ||
          (stream.creator.username.startsWith("jkt48-") && stream.creator.name.endsWith("JKT48")),
      )
      .map((stream) => ({
        uuid: stream.creator.uuid,
        username: stream.creator.username,
        name: stream.creator.name,
        slug: stream.slug,
      }));
  } catch {
    console.error("[gift-chat] failed to fetch live members");
    return [];
  }
}

const manager = new IdnChatManager(
  (line, member, channel) => {
    void ingestChatGift(line, member, channel).catch((error) =>
      console.error(`[gift-chat] failed to store event for ${member.username}:`, error),
    );
  },
  {
    onOpen: noteChatSocketOpen,
    onAttached: noteChatAttached,
    onUnexpectedDisconnect: noteUnexpectedChatDisconnect,
  },
);

async function tick() {
  manager.sync(await fetchLiveMembers());
}

/** Collects IDN chat gifts as a shadow ledger. */
export default function (_client: Client) {
  tick();
  setInterval(tick, 30_000);
}
