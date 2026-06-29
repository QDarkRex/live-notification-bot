import { jkt48ApiGet } from "./jkt48Api";

export interface Schedule {
  showInfo: string;
  setlist: string;
  members: string[]; // Daftar anggota tanpa style
  birthday?: string[] | null;
}

interface Event {
  badgeUrl: string;
  eventName: string;
  eventUrl?: string | undefined;
}

export interface ParsedSchedule {
  tanggal: string;
  hari: string;
  bulan: string;
  events: Event[];
}

/**
 * jkt48.com is now a Nuxt SPA. Schedules come from:
 *   GET /api/v1/schedules?lang=id&month=MM&year=YYYY     (calendar; SHOW/EXCLUSIVE/EVENT)
 *   GET /api/v1/theater-shows/{code}?lang=id             (per-show member lineup)
 *
 * The downstream notifiers/commands parse `showInfo` as
 *   "{DayName}, {D}.{M}.{YYYY} Show {HH:MM}"  (no leading zeros on day/month)
 * so we reproduce exactly that format here.
 */

interface ScheduleApiItem {
  link: string;
  schedule_id: number;
  date: string; // "2026-06-27"
  start_time: string; // "19:00:00"
  end_time: string;
  type: "SHOW" | "EXCLUSIVE" | "EVENT" | string;
  title: string;
  jkt48_member_type?: string | null;
  birthday_member?: string | null;
  reference_code?: string | null;
}

interface TheaterShowApi {
  date: string;
  start_time: string;
  title: string;
  jkt48_member?: { name: string; type: string; member_id: number }[];
  birthday_member_name?: string[];
}

export interface EnrichedShow {
  date: string;
  start_time: string;
  setlist: string;
  members: string[];
  birthday: string[] | null;
}

// getDay() => 0..6 (Sunday..Saturday)
const DAY_NAMES_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
// Abbreviations as the notifiers/commands expect them (note: "Juni"/"Juli"/"Agt"/"Sept")
const MONTH_ABBR_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Juni", "Juli", "Agt", "Sept", "Okt", "Nov", "Des"];
const MONTH_FULL_ID = [
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

function ymd(dateStr: string): { y: number; m: number; d: number; dayName: string } {
  const [y, m, d] = dateStr.split("-").map((n) => Number.parseInt(n, 10));
  const dayName = DAY_NAMES_ID[new Date(y, m - 1, d).getDay()];
  return { y, m, d, dayName };
}

async function fetchMonthSchedule(month: number, year: number): Promise<ScheduleApiItem[]> {
  const mm = String(month).padStart(2, "0");
  return jkt48ApiGet<ScheduleApiItem[]>(`schedules?lang=id&month=${mm}&year=${year}`);
}

/**
 * Fetch theater shows for the current month, enriched with each show's member
 * lineup (via the per-show detail endpoint).
 */
export const getSchedule = async (): Promise<EnrichedShow[] | null> => {
  try {
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();
    const nextMonth = curMonth === 12 ? 1 : curMonth + 1;
    const nextYear = curMonth === 12 ? curYear + 1 : curYear;

    const [curItems, nextItems] = await Promise.all([
      fetchMonthSchedule(curMonth, curYear),
      fetchMonthSchedule(nextMonth, nextYear),
    ]);
    const items = [...(curItems ?? []), ...(nextItems ?? [])];
    const shows = items.filter((i) => i.type === "SHOW");

    const enriched = await Promise.all(
      shows.map(async (s): Promise<EnrichedShow> => {
        let members: string[] = [];
        let birthday: string[] | null = null;

        if (s.reference_code) {
          try {
            const detail = await jkt48ApiGet<TheaterShowApi>(`theater-shows/${s.reference_code}?lang=id`);
            members = (detail.jkt48_member ?? []).map((m) => m.name);
            const bdays = detail.birthday_member_name ?? [];
            birthday = bdays.length > 0 ? bdays : null;
          } catch (err) {
            // Lineup not available yet — fall back to empty members.
          }
        }

        return {
          date: s.date,
          start_time: s.start_time,
          setlist: s.title,
          members,
          birthday,
        };
      }),
    );

    return enriched;
  } catch (error) {
    const err = error as Error;
    console.error("Error fetching schedule:", err.message);
    return null;
  }
};

export const parseScheduleData = (shows: EnrichedShow[]): Schedule[] => {
  return (shows ?? []).map((s) => {
    const { y, m, d, dayName } = ymd(s.date);
    const time = (s.start_time ?? "").slice(0, 5);
    return {
      showInfo: `${dayName}, ${d}.${m}.${y} Show ${time}`,
      setlist: s.setlist,
      members: s.members,
      birthday: s.birthday && s.birthday.length > 0 ? s.birthday : null,
    };
  });
};

/** Build a best-effort public URL (path with leading slash) for an event entry. */
function eventUrlFor(item: ScheduleApiItem): string {
  if (item.type === "EXCLUSIVE" && item.reference_code) {
    return `/purchase/exclusive?code=${item.reference_code}`;
  }
  return "/schedule/theater";
}

/**
 * Fetch the non-theater entries (EVENT/EXCLUSIVE) for the current month, used by
 * the "today/upcoming events" notifiers and the /events command.
 */
export const fetchScheduleSectionData = async (): Promise<ScheduleApiItem[] | null> => {
  try {
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();
    const nextMonth = curMonth === 12 ? 1 : curMonth + 1;
    const nextYear = curMonth === 12 ? curYear + 1 : curYear;

    const [curItems, nextItems] = await Promise.all([
      fetchMonthSchedule(curMonth, curYear),
      fetchMonthSchedule(nextMonth, nextYear),
    ]);
    const items = [...(curItems ?? []), ...(nextItems ?? [])];
    return items.filter((i) => i.type === "EVENT" || i.type === "EXCLUSIVE");
  } catch (error) {
    const err = error as Error;
    console.error("Error fetching schedule section:", err.message);
    return null;
  }
};

export const parseScheduleSectionData = (items: ScheduleApiItem[]): ParsedSchedule[] => {
  // Group events that fall on the same day.
  const byDate = new Map<string, ParsedSchedule>();

  for (const item of items ?? []) {
    const { m, d, dayName } = ymd(item.date);
    const key = item.date;

    if (!byDate.has(key)) {
      byDate.set(key, {
        tanggal: String(d),
        hari: dayName,
        bulan: MONTH_ABBR_ID[m - 1],
        events: [],
      });
    }

    byDate.get(key)?.events.push({
      badgeUrl: "",
      eventName: item.title,
      eventUrl: eventUrlFor(item),
    });
  }

  return Array.from(byDate.values());
};
