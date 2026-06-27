import { jkt48ApiGet } from "./jkt48Api";

interface Event {
  bulan_tahun: string;
  tanggal: string;
  hari: string;
  badge_url?: string | undefined;
  event_name: string;
  event_time: string;
  event_id?: string | undefined;
  have_event: boolean;
}

/**
 * Calendar events now come from the JSON API:
 *   GET /api/v1/schedules?lang=id&month=MM&year=YYYY
 * We treat EVENT/EXCLUSIVE entries (everything that isn't a theater SHOW) as
 * "events", matching the old /calendar/list behaviour.
 */

interface ScheduleApiItem {
  link: string;
  date: string;
  start_time: string;
  type: "SHOW" | "EXCLUSIVE" | "EVENT" | string;
  title: string;
  reference_code?: string | null;
}

const DAY_NAMES_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
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

export const fetchEvents = async (): Promise<ScheduleApiItem[] | null> => {
  try {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const items = await jkt48ApiGet<ScheduleApiItem[]>(`schedules?lang=id&month=${mm}&year=${now.getFullYear()}`);
    return items.filter((i) => i.type === "EVENT" || i.type === "EXCLUSIVE");
  } catch (error) {
    const err = error as Error;
    console.error("Error fetching events:", err.message);
    return null;
  }
};

export const parseEvents = (items: ScheduleApiItem[]): Event[] => {
  return (items ?? []).map((item) => {
    const [y, m, d] = item.date.split("-").map((n) => Number.parseInt(n, 10));
    const dayName = DAY_NAMES_ID[new Date(y, m - 1, d).getDay()];
    return {
      bulan_tahun: `${MONTH_FULL_ID[m - 1]} ${y}`,
      tanggal: String(d),
      hari: dayName,
      badge_url: "",
      event_name: item.title,
      event_time: (item.start_time ?? "").slice(0, 5),
      event_id: item.link,
      have_event: true,
    };
  });
};
