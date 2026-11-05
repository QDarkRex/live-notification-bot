import { env } from "@/common/utils/envConfig";
import axios from "axios";
import type { SlashCommandProps } from "commandkit";
import { ActionRowBuilder, SlashCommandBuilder, StringSelectMenuBuilder } from "discord.js";

export const data = new SlashCommandBuilder().setName("news").setDescription("Menampilkan berita terbaru dari JKT48");

export async function run({ interaction }: SlashCommandProps) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const response = await axios.get(`http://${env.HOST}:${env.PORT}/news`);
    const newsList = response.data.berita;

    if (!Array.isArray(newsList) || newsList.length === 0) {
      return interaction.editReply({
        content: "Tidak ada berita yang tersedia.",
      });
    }

    const limitedNewsList = newsList.slice(0, 10);

    const options = limitedNewsList.map((news) => ({
      label: news.judul.length > 100 ? news.judul.substring(0, 97) + "..." : news.judul,
      value: news.berita_id.toString(),
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("select_news")
      .setPlaceholder("Silahkan pilih news")
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.editReply({
      content: "Silahkan pilih news:",
      components: [row],
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 503) {
      await interaction.editReply({
        content: "Berita sementara tidak tersedia (jkt48.com tidak bisa diakses dari server bot). Coba lagi nanti.",
      });
      return;
    }
    console.error("Error fetching news:", error);
    await interaction.editReply({
      content: "Terjadi kesalahan saat mengambil data berita.",
    });
  }
}
