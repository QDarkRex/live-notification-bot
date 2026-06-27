import { readFileSync } from "node:fs";
import type { SlashCommandProps } from "commandkit";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { Member } from "@/commands/schedule";
import { parseBirthday } from "@/common/utils/memberBirthday";

export const data = new SlashCommandBuilder()
  .setName("birthday")
  .setDescription("Menampilkan 10 ulang tahun member JKT48 yang akan datang");

function daysUntil(monthIndex: number, day: number, today: Date): number {
  const thisYear = today.getFullYear();
  const next = new Date(thisYear, monthIndex, day);
  if (next < today) next.setFullYear(thisYear + 1);
  return Math.round((next.getTime() - today.getTime()) / 86400000);
}

export async function run({ interaction }: SlashCommandProps) {
  await interaction.deferReply();
  try {
    const members: Member[] = JSON.parse(readFileSync("member.json", "utf8"));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = members
      .map((m) => {
        const b = parseBirthday(m);
        if (!b) return null;
        return { ...b, daysLeft: daysUntil(b.monthIndex, b.day, today) };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 10);

    if (upcoming.length === 0) {
      return interaction.editReply({ content: "Tidak ada data ulang tahun yang tersedia." });
    }

    const embed = new EmbedBuilder()
      .setTitle("🎂 Ulang Tahun Member JKT48 Berikutnya")
      .setColor("#ff0000")
      .setFooter({ text: "Birthday JKT48 | JKT48 Live Notification" });

    for (const b of upcoming) {
      const age = today.getFullYear() - b.year + (b.daysLeft === 0 ? 0 : 1);
      const label = b.daysLeft === 0 ? "🎉 Hari ini!" : `${b.daysLeft} hari lagi`;
      embed.addFields({ name: b.name, value: `📅 ${b.raw} • ke-${age} • ${label}`, inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error fetching birthdays:", error);
    await interaction.editReply({ content: "Terjadi kesalahan saat mengambil data ulang tahun." });
  }
}
