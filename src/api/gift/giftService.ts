import { env } from "@/common/utils/envConfig";
import axios from "axios";

export interface Gift {
  status: number;
  message: string;
  data: Datum[];
}

export interface Datum {
  rank: number;
  name: string;
  image_url: string;
  uuid: string;
  total_point: number;
  total_gold: number;
  level_tier: number;
  cta: null;
}

/**
 * IDN's ranking for a streamer. Note: this is IDN's running total for the
 * current day (it resets daily), not for one live session.
 */
export async function fetchGiftRanking(uuid_streamer: string): Promise<Datum[]> {
  const url = `https://api.idn.app/api/v1/gift/livestream/top-rank?uuid_streamer=${uuid_streamer}&n=1`;
  const response = await axios.get<Gift>(url, {
    headers: {
      "X-API-KEY": env.X_API_KEY,
    },
    timeout: 20000,
  });
  return response.data.data ?? [];
}

export async function scrapeGiftData(uuid_streamer: string) {
  const ranking = await fetchGiftRanking(uuid_streamer);

  const rankData = ranking.slice(0, 10).map((item: any) => ({
    image_url: item.image_url,
    rank: item.rank,
    name: item.name,
    gold: `${item.total_gold} Gold`,
    point: `${item.total_point} Point`,
  }));

  return rankData;
}
