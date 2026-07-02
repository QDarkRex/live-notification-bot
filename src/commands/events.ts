import axios from "axios";
import type { SlashCommandProps } from "commandkit";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import type { ParsedSchedule } from "@/common/utils/calendar";
import { env } from "@/common/utils/envConfig";

export const data = new SlashCommandBuilder().setName("events").setDescription("Menampilkan jadwal event offair JKT48");

export async function run({ interaction }: SlashCommandProps) {
  await interaction.deferReply({ ephemeral: true });
  try {
    // Fetch data from the API
    const response = await axios.get<ParsedSchedule[]>(`http://${env.HOST}:${env.PORT}/schedule/section`);
    const eventSections = response.data;

    if (!eventSections || eventSections.length === 0) {
      return interaction.editReply({
        content: "Tidak ada event yang tersedia.",
      });
    }

    const nowYear = new Date().getFullYear();
    const embed = new EmbedBuilder().setTitle("Jadwal Event Offair yang Akan Datang").setColor("#FF0000");

    // Discord embeds allow at most 25 fields; we now fetch two months of events,
    // so cap the total to stay within the limit.
    const MAX_FIELDS = 25;
    let count = 0;
    for (const section of eventSections) {
      const { hari, tanggal, bulan, events } = section;
      for (const event of events) {
        if (count >= MAX_FIELDS) break;
        embed.addFields({
          name: event.eventName,
          value: `🗓️ ${hari} ${tanggal}/${bulan}/${nowYear}\n🔗 [Link Event](https:jkt48.com${event.eventUrl})`,
          inline: false,
        });
        count++;
      }
      if (count >= MAX_FIELDS) break;
    }

    if (count === 0) {
      return interaction.editReply({ content: "Tidak ada event yang tersedia." });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error fetching events:", JSON.stringify(error));
    await interaction.editReply({
      content: "Terjadi kesalahan saat mengambil data event.",
    });
  }
}
