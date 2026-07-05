import { fetchScheduleSectionData, parseScheduleSectionData } from "@/common/utils/calendar";
import type { SlashCommandProps } from "commandkit";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder().setName("events").setDescription("Menampilkan jadwal event offair JKT48");

function eventDetailUrl(path: string | undefined): string {
  return new URL(path ?? "/schedule/theater", "https://jkt48.com").toString();
}

export async function run({ interaction }: SlashCommandProps) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const eventData = await fetchScheduleSectionData();
    const eventSections = parseScheduleSectionData(eventData ?? []);

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
        const detailUrl = eventDetailUrl(event.eventUrl);
        embed.addFields({
          name: event.eventName,
          value: `Tanggal: ${hari} ${tanggal} ${bulan} ${nowYear}\nLink Event: ${detailUrl}`,
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
    console.error("Error fetching events:", error);
    await interaction.editReply({
      content: "Terjadi kesalahan saat mengambil data event.",
    });
  }
}
