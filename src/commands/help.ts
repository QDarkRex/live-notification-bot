import type { SlashCommandProps } from "commandkit";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Daftar perintah bot JKT48 Live Notification dan cara pakainya");

export async function run({ interaction, client }: SlashCommandProps) {
  const author = { name: "JKT48 Live Notification — Bantuan", iconURL: client.user.displayAvatarURL() };

  const setupEmbed = new EmbedBuilder()
    .setColor("#ff0000")
    .setAuthor(author)
    .setTitle("⚙️ Pengaturan Notifikasi")
    .setDescription("Perintah untuk mengatur channel & role notifikasi (butuh izin admin server).")
    .addFields(
      {
        name: "/whitelist `channel`",
        value: "Daftarkan channel agar menerima notifikasi member sedang live (IDN & Showroom).",
      },
      { name: "/unwhitelist `channel`", value: "Hapus channel dari whitelist notifikasi live." },
      { name: "/tagrole `roles`", value: "Set role yang otomatis di-tag setiap ada member live." },
      { name: "/removetagrole", value: "Hapus role yang di-tag pada notifikasi live." },
      {
        name: "/whitelist_schedule `channel`",
        value: "Daftarkan channel untuk notifikasi jadwal theater, news, & ulang tahun.",
      },
      { name: "/unwhitelist_schedule `channel`", value: "Hapus channel dari whitelist jadwal/website." },
      { name: "/webhook `url`", value: "Daftarkan webhook untuk menerima notifikasi (perlu persetujuan admin)." },
      { name: "/removewebhook `url`", value: "Hapus webhook dari daftar." },
    )
    .setFooter({ text: "JKT48 Live Notification • 1/2" });

  const infoEmbed = new EmbedBuilder()
    .setColor("#ff0000")
    .setAuthor(author)
    .setTitle("📋 Info JKT48 & Lainnya")
    .setDescription("Perintah informasi yang bisa dipakai siapa saja.")
    .addFields(
      { name: "/nowlive", value: "Lihat daftar member yang sedang live sekarang." },
      { name: "/schedule", value: "Lihat jadwal show theater JKT48." },
      { name: "/events", value: "Lihat jadwal event off-air JKT48 yang akan datang." },
      { name: "/birthday", value: "Lihat 10 ulang tahun member JKT48 terdekat." },
      { name: "/news", value: "Lihat berita terbaru dari JKT48." },
      {
        name: "/tiket `kode`",
        value:
          "Cek sisa tiket JKT48 (theater show / 2-shot / video call / photobook / photocard).\nContoh: `/tiket kode:SHCB04` (show) atau `/tiket kode:EXCB75` (exclusive).",
      },
      {
        name: "/announce `message`",
        value: "(Admin) Kirim pengumuman ke semua channel whitelist. Pisahkan baris dengan `|`.",
      },
      { name: "/send `channel` `message`", value: "(Admin) Kirim pesan ke channel tertentu lewat bot." },
      { name: "/ping", value: "Cek apakah bot sedang aktif." },
      { name: "/donate", value: "Dukung kelangsungan bot ini." },
      { name: "/help", value: "Tampilkan daftar perintah ini." },
    )
    .setFooter({ text: "JKT48 Live Notification • 2/2" });

  const links = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setLabel("Server Support").setURL("https://discord.gg/TZCSuEAn3j").setStyle(ButtonStyle.Link),
    new ButtonBuilder()
      .setLabel("Vote Bot")
      .setURL("https://top.gg/bot/1253053660242514022/vote")
      .setStyle(ButtonStyle.Link),
    new ButtonBuilder().setLabel("Donate").setURL("https://saweria.co/Ryuu48").setStyle(ButtonStyle.Link),
  );

  await interaction.reply({
    embeds: [setupEmbed, infoEmbed],
    components: [links],
  });
}
