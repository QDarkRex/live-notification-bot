import * as cheerio from "cheerio";
import { jkt48ApiGet } from "./jkt48Api";

export type ParsedNews = ReturnType<typeof parseNewsData>;

interface News {
  badge_url?: string | undefined;
  waktu: string;
  judul: string;
  /** Now a slug (e.g. "pengumuman-...") instead of the old numeric id. */
  berita_id: string;
}

interface NewsDetails {
  judul: string;
  tanggal: string;
  konten: string;
  gambar?: string[] | null;
}

/**
 * NOTE: jkt48.com migrated to a Nuxt SPA + JSON API. News is now served by
 *   GET /api/v1/news?lang=id            (list)
 *   GET /api/v1/news/{slug}?lang=id     (detail)
 * and is keyed by a slug, not the old numeric id.
 */

/** Item shape from GET /api/v1/news */
export interface NewsApiItem {
  total_row_count?: string;
  title: string;
  category: string;
  /** slug used for the detail endpoint and public URL */
  link: string;
  background_image?: string | null;
  is_published?: boolean;
  valid_date_from?: string | null;
  news_id?: number;
}

/** Shape from GET /api/v1/news/{slug} */
interface NewsDetailApi {
  count?: number;
  result?: {
    title?: string;
    category?: string;
    link?: string;
    valid_date_from?: string | null;
    content_body?: string;
  };
}

/**
 * `FlareSolved` is kept here for backwards compatibility: other modules
 * (video.ts, birthday.ts) still import this type from "./news".
 */
export interface FlareSolved {
  solution: Solution;
  status: string;
  message: string;
  startTimestamp: number;
  endTimestamp: number;
  version: string;
}

export interface Solution {
  url: string;
  status: number;
  headers: Record<string, string>;
  response: string;
  cookies: unknown[];
  userAgent: string;
}

const ID_MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function formatIdDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${ID_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Fetch the latest news list from the JSON API. */
export const fetchNewsData = async (): Promise<NewsApiItem[] | null> => {
  try {
    return await jkt48ApiGet<NewsApiItem[]>("news?lang=id");
  } catch (error) {
    const err = error as Error;
    console.error("Error fetching news data:", err.message);
    return null;
  }
};

/** Map the API list into the legacy `{ berita: News[] }` shape consumers expect. */
export const parseNewsData = (items: NewsApiItem[]) => {
  const berita: News[] = (items ?? []).map((item) => ({
    berita_id: item.link,
    judul: item.title,
    waktu: formatIdDate(item.valid_date_from),
    badge_url: undefined,
  }));

  return { berita };
};

/** Fetch + map a single article by slug. */
export const fetchNewsDetail = async (slug: string): Promise<NewsDetails | null> => {
  try {
    const detail = await jkt48ApiGet<NewsDetailApi>(`news/${slug}?lang=id`);
    const result = detail?.result;
    if (!result) return null;

    const html = result.content_body ?? "";
    const $ = cheerio.load(html);

    // Plain-text content (the old scraper returned text, not HTML)
    const konten = $.root()
      .text()
      .replace(/ /g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const gambar = $("img")
      .map((_, el) => $(el).attr("src"))
      .get()
      .filter(Boolean);

    return {
      judul: result.title ?? "",
      tanggal: formatIdDate(result.valid_date_from),
      konten,
      gambar: gambar.length > 0 ? gambar : null,
    };
  } catch (error) {
    const err = error as Error;
    console.error("Error fetching news detail:", err.message);
    return null;
  }
};
