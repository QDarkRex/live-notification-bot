import { readFile } from "node:fs";
import type { Schedule } from "@/common/utils/calendar";
import { env } from "@/common/utils/envConfig";
import axios from "axios";
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
  return member && member.nicknames.length > 0 ? member.nicknames[0] : null;
}

export async function run({ interaction }: SlashCommandProps) {
  try {
    const response = await axios.get<Schedule[]>(`http://${env.HOST}:${env.PORT}/schedule`);
    const schedules = response.data;

    if (schedules.length === 0) {
      return interaction.reply({
        content: "Tidak ada jadwal show yang tersedia.",
      });
    }

    const embed = new EmbedBuilder().setTitle("Berikut adalah jadwal show/event yang akan datang.").setColor("#ff0000");

    schedules.forEach((schedule) => {
      const showInfoParts = schedule.showInfo.split("Show");
      const dateTime = showInfoParts[0].trim();
      const time = showInfoParts[1].trim();

      const dateParts = dateTime.split(", ");
      if (dateParts.length < 2) {
        console.error("Invalid date format:", dateTime);
        return;
      }

      const dayOfWeek = dateParts[0];
      const dayAndMonthYear = dateParts[1].split(".");
      if (dayAndMonthYear.length < 3) {
        console.error("Invalid date format:", dateParts[1]);
        return;
      }

      const day = dayAndMonthYear[0].trim();
      const monthIndex = Number.parseInt(dayAndMonthYear[1], 10) - 1;
      const year = dayAndMonthYear[2].trim();
      const monthName = monthNames[monthIndex];

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
    });

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error("Error fetching schedules:", error);
    await interaction.reply({
      content: "Terjadi kesalahan saat mengambil data jadwal.",
      ephemeral: true,
    });
  }
}
