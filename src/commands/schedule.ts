import { readFile } from "node:fs";
import { getSchedule, parseScheduleData } from "@/common/utils/calendar";
import type { SlashCommandProps } from "commandkit";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

export interface Member {
  _id?: string;
  name: string;
  nicknames: string[];
  img?: string;
  img_alt: string;
  url: string;
  group: Group;
  video_perkenalan: string;
  description: string;
  jikosokai: string;
  socials?: Social[];
  room_id?: number;
  sr_exists?: boolean;
  is_graduate: boolean;
  height: string;
  generation: string;
  idn_username?: string;
}

export enum Group {
  Jkt48 = "jkt48",
}

export interface Social {
  title: Title;
  url: string;
}

export enum Title {
  Idn = "IDN",
  Instagram = "Instagram",
  Showroom = "SHOWROOM",
  TikTok = "TikTok",
  Twitter = "Twitter",
  YouTube = "YouTube",
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Juni", "Juli", "Agt", "Sept", "Okt", "Nov", "Des"];

export const data = new SlashCommandBuilder().setName("schedule").setDescription("Menampilkan jadwal show JKT48");

let membersData: Member[] = [];
readFile("member.json", "utf8", (err, data) => {
  if (err) {
    console.error("Error reading member data:", err);
    return;
  }
  membersData = JSON.parse(data);
});

function getNickname(name: string) {
  const member = membersData.find((m) => m.name === name);
  // Fall back to the full name if the member isn't in member.json (or has no
  // nickname) so performers are never silently dropped from the list.
  return member?.nicknames[0] ?? name;
}

export async function run({ interaction }: SlashCommandProps) {
  await interaction.deferReply();

  try {
    const showData = await getSchedule();
    const schedules = parseScheduleData(showData ?? []);

    if (schedules.length === 0) {
      return interaction.editReply({
        content: "Tidak ada jadwal show yang tersedia.",
      });
    }

    const embed = new EmbedBuilder().setTitle("Berikut adalah jadwal show/event yang akan datang.").setColor("#ff0000");

    // We now fetch the current + next month, which can yield >25 shows. Discord
    // embeds allow at most 25 fields, so parse each show's date, drop past ones,
    // sort soonest-first, and cap at 25 to stay within the limit.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const upcoming = schedules
      .map((schedule) => {
        const [datePart, timePart] = schedule.showInfo.split("Show");
        const time = (timePart ?? "").trim();
        const dmy = (datePart ?? "").trim().split(", ")[1]?.split(".") ?? [];
        if (dmy.length < 3) return null;
        const day = Number.parseInt(dmy[0], 10);
        const month = Number.parseInt(dmy[1], 10);
        const year = Number.parseInt(dmy[2], 10);
        if ([day, month, year].some(Number.isNaN)) return null;
        return { schedule, time, date: new Date(year, month - 1, day), day, month, year };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && x.date >= startOfToday)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 25);

    if (upcoming.length === 0) {
      return interaction.editReply({ content: "Tidak ada jadwal show yang akan datang." });
    }

    for (const { schedule, time, day, month, year } of upcoming) {
      const monthName = monthNames[month - 1];
      const memberNicknames = schedule.members
        .map(getNickname)
        .filter((nickname) => nickname)
        .join(", ");
      const birthday = schedule.birthday || "";

      embed.addFields({
        name: schedule.setlist,
        value: `🕒 ${time}\n🗓️ ${day} ${monthName} ${year}${
          birthday ? `\n🎂 ${birthday}` : ""
        }${memberNicknames ? `\n👥 ${memberNicknames}` : ""}`,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error fetching schedules:", error);
    await interaction.editReply({
      content: "Terjadi kesalahan saat mengambil data jadwal.",
    });
  }
}
