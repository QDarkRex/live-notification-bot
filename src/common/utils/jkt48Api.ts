import axios from "axios";
import * as cheerio from "cheerio";
import { env } from "./envConfig";

/**
 * Shared client for the new jkt48.com JSON API (Nuxt rewrite, mid-2026).
 *
 * The website migrated from server-rendered HTML to a Nuxt SPA backed by
 * `https://jkt48.com/api/v1/...`. All the old cheerio scrapers broke because
 * the HTML they targeted no longer exists.
 *
 * Strategy: try a direct request first (fast, no extra infra). If that fails
 * (Cloudflare challenge from a datacenter IP, etc.) fall back to FlareSolverr,
 * which renders the page in a real browser. FlareSolverr returns the JSON
 * wrapped in an HTML shell, so we unwrap it before parsing.
 */

export const JKT48_API_BASE = "https://jkt48.com/api/v1";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8",
  Referer: "https://jkt48.com/",
};

/** Standard envelope returned by every /api/v1 endpoint. */
export interface ApiEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
  error?: string;
}

interface FlareSolverrResponse {
  solution?: { response?: string };
}

/**
 * Pull a JSON value out of whatever FlareSolverr returns. It may be:
 *  - raw JSON text, or
 *  - JSON inside a `<pre>` tag (Chrome's JSON viewer), or
 *  - JSON embedded somewhere in an HTML document.
 */
function extractJson<T>(raw: string): T {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    throw new Error("Empty response body from FlareSolverr");
  }

  // 1) Already pure JSON
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // continue
  }

  // 2) Chrome renders JSON inside <pre>...</pre>; cheerio decodes entities for us
  try {
    const $ = cheerio.load(trimmed);
    const preText = $("pre").first().text().trim();
    if (preText) {
      return JSON.parse(preText) as T;
    }
    const bodyText = $("body").text().trim();
    if (bodyText) {
      return JSON.parse(bodyText) as T;
    }
  } catch {
    // continue
  }

  // 3) Last resort: slice between the first opening and last closing bracket
  const firstBrace = trimmed.search(/[[{]/);
  const lastBrace = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
  }

  throw new Error("Could not extract JSON from JKT48 API response");
}

async function viaFlareSolverr<T>(url: string): Promise<T> {
  const response = await axios.post<FlareSolverrResponse>(
    `${env.FLARE_SOLVER_BASE}/v1`,
    {
      cmd: "request.get",
      url,
      maxTimeout: 60000,
    },
    {
      headers: { "Content-Type": "application/json" },
    },
  );
  const raw = response.data?.solution?.response ?? "";
  return extractJson<T>(raw);
}

/**
 * GET a path under /api/v1 and return the raw envelope.
 * Tries direct axios first, then FlareSolverr.
 *
 * @param path e.g. `news?lang=id&page=1` (no leading slash)
 */
export async function jkt48ApiRaw<T>(path: string): Promise<ApiEnvelope<T>> {
  const url = `${JKT48_API_BASE}/${path}`;

  // 1) Direct request
  try {
    const res = await axios.get<ApiEnvelope<T>>(url, {
      headers: BROWSER_HEADERS,
      timeout: 20000,
      // a 4xx should trigger the fallback rather than throw raw
      validateStatus: (s) => s >= 200 && s < 500,
    });
    if (res.status === 200 && res.data && typeof res.data === "object") {
      return res.data;
    }
  } catch {
    // fall through to FlareSolverr
  }

  // 2) FlareSolverr fallback
  return viaFlareSolverr<ApiEnvelope<T>>(url);
}

/**
 * GET a path and return just the `data` field, throwing on a non-success
 * envelope. Use this for the common case.
 */
export async function jkt48ApiGet<T>(path: string): Promise<T> {
  const envelope = await jkt48ApiRaw<T>(path);
  if (!envelope || envelope.status !== true) {
    throw new Error(`JKT48 API error for "${path}": ${envelope?.message ?? "unknown error"}`);
  }
  return envelope.data;
}
