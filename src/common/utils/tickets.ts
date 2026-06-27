import { jkt48ApiRaw } from "./jkt48Api";

/**
 * On-demand ticket availability for JKT48 purchases:
 *   - Exclusives (2-shot, digital photobook bonus video call, photocard, ...):
 *       GET /api/v1/exclusives/{code}?lang=id           -> per-member available_quota
 *   - Theater shows:
 *       GET /api/v1/theater-shows/{code}?lang=id         -> sales periods
 *       GET /api/v1/theater-shows/{code}/pricing?lang=id -> live remaining (FCFS / active window)
 *
 * "Remaining" is only really meaningful for first-come-first-served (FCFS) windows
 * and for exclusives; OFC/General raffle windows have a fixed quota drawn by lottery.
 */

// ---------- Exclusive shapes ----------
interface ExclusiveSessionDetail {
  label: string; // "Jalur 1"
  tickets_sold: number;
  jkt48_member_name: string;
  available_quota: number;
}

interface ExclusiveSession {
  label: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  session_detail?: ExclusiveSessionDetail[];
}

export interface ExclusiveData {
  exclusive_id?: number;
  category?: string;
  code: string;
  title?: string;
  default_price?: number;
  total_quota?: number;
  valid_date_to?: string | null;
  session?: ExclusiveSession[];
}

// ---------- Theater show shapes ----------
interface ShowPeriodPricing {
  label: string;
  price: number;
  quota: number;
  is_ofc_only?: boolean;
}

interface ShowSalesPeriod {
  label: string;
  start_date: string;
  end_date: string;
  sales_method?: string; // "RAFFLE" | "FCFS"
  pricing?: ShowPeriodPricing[];
}

export interface ShowData {
  code: string;
  title?: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  total_quota?: number;
  default_price?: number;
  jkt48_member_type?: string | null;
  jkt48_member?: { name: string }[];
  sales_period?: ShowSalesPeriod[];
}

interface ShowPricingPeriod {
  sales_period_label: string;
  sales_method?: string;
  sales_period_start_date?: string;
  sales_period_end_date?: string;
  prices?: { label: string; price: number; quota: number }[];
}

export type TicketResult =
  | { kind: "exclusive"; data: ExclusiveData }
  | { kind: "show"; data: ShowData; pricing: ShowPricingPeriod[] }
  | { kind: "notfound" };

function looksValid(data: unknown): data is Record<string, unknown> {
  return !!data && typeof data === "object" && !Array.isArray(data) && "code" in (data as object);
}

async function tryExclusive(code: string): Promise<ExclusiveData | null> {
  try {
    const env = await jkt48ApiRaw<ExclusiveData>(`exclusives/${code}?lang=id`);
    if (env.status && looksValid(env.data)) return env.data;
  } catch {
    /* ignore */
  }
  return null;
}

async function tryShow(code: string): Promise<{ data: ShowData; pricing: ShowPricingPeriod[] } | null> {
  try {
    const env = await jkt48ApiRaw<ShowData>(`theater-shows/${code}?lang=id`);
    if (!env.status || !looksValid(env.data)) return null;
    let pricing: ShowPricingPeriod[] = [];
    try {
      const pr = await jkt48ApiRaw<ShowPricingPeriod[]>(`theater-shows/${code}/pricing?lang=id`);
      if (pr.status && Array.isArray(pr.data)) pricing = pr.data;
    } catch {
      /* pricing is best-effort */
    }
    return { data: env.data, pricing };
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Resolve a code to either an exclusive or a theater show. Theater-show codes
 * usually start with "SH", exclusives with "EX", but we fall back to trying the
 * other type so the user can paste any code.
 */
export async function resolveTicket(rawCode: string): Promise<TicketResult> {
  const code = rawCode.trim().toUpperCase();

  const showFirst = code.startsWith("SH");
  if (showFirst) {
    const s = await tryShow(code);
    if (s) return { kind: "show", ...s };
    const e = await tryExclusive(code);
    if (e) return { kind: "exclusive", data: e };
  } else {
    const e = await tryExclusive(code);
    if (e) return { kind: "exclusive", data: e };
    const s = await tryShow(code);
    if (s) return { kind: "show", ...s };
  }

  return { kind: "notfound" };
}

// ---------- Formatting helpers ----------

const rupiah = (n?: number) => (typeof n === "number" ? `Rp${n.toLocaleString("id-ID")}` : "-");

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

export interface FormattedTicket {
  title: string;
  description: string;
}

/** Per-member remaining quota, summed across all of that member's sessions. */
export function formatExclusive(data: ExclusiveData): FormattedTicket {
  const sessions = data.session ?? [];
  const totals = new Map<string, { available: number; sold: number; sessions: number }>();

  for (const sesi of sessions) {
    for (const slot of sesi.session_detail ?? []) {
      const cur = totals.get(slot.jkt48_member_name) ?? { available: 0, sold: 0, sessions: 0 };
      cur.available += slot.available_quota;
      cur.sold += slot.tickets_sold;
      cur.sessions += 1;
      totals.set(slot.jkt48_member_name, cur);
    }
  }

  const header = [
    `Kode: \`${data.code}\``,
    data.category ? `Kategori: ${data.category}` : "",
    typeof data.total_quota === "number" ? `Kuota total: ${data.total_quota}` : "",
    typeof data.default_price === "number" ? `Harga: ${rupiah(data.default_price)}` : "",
  ]
    .filter(Boolean)
    .join(" • ");

  let body: string;
  if (totals.size === 0) {
    body =
      typeof data.total_quota === "number"
        ? `Sisa kuota: **${data.total_quota}** (tidak ada rincian per member)`
        : "Tidak ada rincian tiket.";
  } else {
    const lines = ["```", `${pad("Member", 24)} Sisa`, "─".repeat(34)];
    let totalAvail = 0;
    for (const [name, st] of [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      totalAvail += st.available;
      lines.push(`${pad(name, 24)} ${st.available === 0 ? "SOLD OUT" : st.available}`);
    }
    lines.push("```", `**Total tersisa: ${totalAvail}**`);
    body = lines.join("\n");
  }

  return {
    title: `🎟️ ${data.title ?? data.code}`,
    description: `${header}\n\n${body}`,
  };
}

export function formatShow(data: ShowData, pricing: ShowPricingPeriod[]): FormattedTicket {
  // Live remaining quota (per active sales period) comes from the pricing endpoint.
  const liveByLabel = new Map<string, { quota: number; method?: string }>();
  for (const period of pricing ?? []) {
    for (const pr of period.prices ?? []) {
      liveByLabel.set(period.sales_period_label, { quota: pr.quota, method: period.sales_method });
    }
  }

  const header = [
    `Kode: \`${data.code}\``,
    data.jkt48_member_type ? `Tim: ${data.jkt48_member_type}` : "",
    data.date ? `📅 ${data.date}${data.start_time ? ` ${data.start_time}` : ""}` : "",
    typeof data.total_quota === "number" ? `Kuota total: ${data.total_quota}` : "",
  ]
    .filter(Boolean)
    .join(" • ");

  const lines = ["```", `${pad("Periode", 18)} ${pad("Metode", 8)} ${pad("Harga", 11)} Sisa`, "─".repeat(48)];

  for (const period of data.sales_period ?? []) {
    const method = period.sales_method ?? "";
    const live = liveByLabel.get(period.label);
    const price = period.pricing?.[0]?.price;

    let remaining: string;
    if (live) {
      // Active window — pricing endpoint gives the live remaining quota.
      remaining = String(live.quota);
    } else if (method === "FCFS") {
      remaining = `~${period.pricing?.[0]?.quota ?? "?"}`;
    } else {
      // Raffle window: fixed quota drawn by lottery, no "remaining" concept.
      remaining = `kuota ${period.pricing?.[0]?.quota ?? "?"}`;
    }

    lines.push(`${pad(period.label, 18)} ${pad(method, 8)} ${pad(rupiah(price), 11)} ${remaining}`);
  }
  lines.push("```");

  // The pricing endpoint only returns currently-active windows, so the first
  // live entry is the one a buyer can act on right now.
  const active = [...liveByLabel.entries()][0];
  const note = active
    ? `\n🟢 Penjualan aktif (**${active[0]}**): **${active[1].quota}** tersisa`
    : "\nℹ️ Tidak ada penjualan aktif saat ini (sisa hanya tampil saat window FCFS berjalan).";

  const members = (data.jkt48_member ?? []).map((m) => m.name);
  const memberLine = members.length > 0 ? `\n👥 ${members.join(", ")}` : "";

  return {
    title: `🎭 ${data.title ?? data.code}`,
    description: `${header}\n${lines.join("\n")}${note}${memberLine}`,
  };
}
