import axios from "axios";
import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, type Interaction } from "discord.js";
import { env } from "./envConfig";

export async function handleSelect(interaction: Interaction) {
  if (!interaction.isStringSelectMenu()) return;

  await interaction.deferUpdate();

  const selectedId = interaction.values[0];

  try {
    const response = await axios.get(`http://${env.HOST}:${env.PORT}/news/detail/${selectedId}`);
    const newsDetail = response.data.data;

    if (!newsDetail.judul || !newsDetail.konten) {
      throw new Error("Detail berita tidak lengkap");
    }

    const embed = new EmbedBuilder()
      .setTitle(newsDetail.judul)
      .setDescription(`\`\`\`${newsDetail.konten}\`\`\``)
      .setFooter({ text: "News detail | JKT48 Live Notification" })
      .setColor("#ff0000");

    const button = new ButtonBuilder()
      .setLabel("Baca Selengkapnya")
      .setStyle(5)
      .setURL(`https://jkt48.com/news/${selectedId}?lang=id`);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    await interaction.editReply({ content: "", embeds: [embed], components: [row] });
  } catch (error) {
    console.error("Error fetching news detail:", error);
    await interaction.editReply({
      content: "Terjadi kesalahan saat mengambil detail berita.",
      components: [],
    });
  }
}
