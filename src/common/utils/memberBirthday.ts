import type { Member } from "@/commands/schedule";

/**
 * Birthday data is no longer scrapeable from jkt48.com (Nuxt rewrite). It is,
 * however, embedded in the bundled `member.json` descriptions, e.g.
 *   "📌 Name: ...\n🎂 Birthday: 6 Agustus 2008\n🩸 Blood type: B..."
 * The month is in Indonesian OR English (member.json mixes both), so `new Date()`
 * can't reliably parse it — we map the month name ourselves.
 */

// month name (lowercase, Indonesian + English) -> 0-based index
const MONTH_INDEX: Record<string, number> = {
  januari: 0, january: 0,
  februari: 1, february: 1,
  maret: 2, march: 2,
  april: 3,
  mei: 4, may: 4,
  juni: 5, june: 5,
  juli: 6, july: 6,
  agustus: 7, august: 7,
  september: 8,
  oktober: 9, october: 9,
  november: 10,
  desember: 11, december: 11,
};

export interface ParsedBirthday {
  name: string;
  day: number;
  monthIndex: number; // 0-11
  year: number;
  raw: string; // "6 Agustus 2008"
}

/** Extract a member's birthday from their `description`, or null if absent/unparseable. */
export function parseBirthday(member: Member): ParsedBirthday | null {
  const match = member.description?.match(/Birthday:\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!match) return null;

  const day = Number.parseInt(match[1], 10);
  const monthIndex = MONTH_INDEX[match[2].toLowerCase()] ?? -1;
  const year = Number.parseInt(match[3], 10);
  if (monthIndex < 0) return null;

  return { name: member.name, day, monthIndex, year, raw: `${match[1]} ${match[2]} ${match[3]}` };
}

/** Members whose birthday falls on `today` (day + month match). */
export function membersBirthdayToday(members: Member[], today: Date = new Date()): ParsedBirthday[] {
  return members
    .map(parseBirthday)
    .filter((b): b is ParsedBirthday => b !== null && b.day === today.getDate() && b.monthIndex === today.getMonth());
}

/** Best profile link for a member: prefer Instagram, then any social. */
export function memberProfileUrl(member: Member): string {
  const socials = member.socials ?? [];
  const ig = socials.find((s) => s.title === "Instagram");
  return ig?.url ?? socials[0]?.url ?? "";
}
