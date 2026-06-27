import type { SlashCommandProps } from "commandkit";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { formatExclusive, formatShow, resolveTicket } from "@/common/utils/tickets";

export const data = new SlashCommandBuilder()
  .setName("tiket")
  .setDescription("Cek sisa tiket JKT48 (theater show / 2-shot / video call / photobook / photocard)")
  .addStringOption((opt) =>
    opt.setName("kode").setDescription("Kode tiket, mis. SHCB04 (show) atau EXCB75 (exclusive)").setRequired(true),
  );

export async function run({ interaction }: SlashCommandProps) {
  await interaction.deferReply();

  const code = interaction.options.getString("kode", true).trim().toUpperCase();

  try {
    const result = await resolveTicket(code);

    if (result.kind === "notfound") {
      await interaction.editReply({
        content: `Tiket dengan kode \`${code}\` tidak ditemukan. Pastikan kodenya benar (mis. \`SHCB04\` untuk show, \`EXCB75\` untuk exclusive).`,
      });
      return;
    }

    const formatted =
      result.kind === "exclusive" ? formatExclusive(result.data) : formatShow(result.data, result.pricing);

    const embed = new EmbedBuilder()
      .setTitle(formatted.title)
      .setDescription(formatted.description.slice(0, 4096))
      .setColor("#ff0000")
      .setFooter({ text: "Sisa Tiket JKT48 | JKT48 Live Notification" })
      .setTimestamp(new Date());

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error fetching ticket info:", error);
    await interaction.editReply({
      content: "Terjadi kesalahan saat mengambil data tiket. Coba lagi nanti.",
    });
  }
}
