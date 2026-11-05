import { formatDuration } from "@/commands/riwayat";
import db from "@/common/utils/db";
import { liveSnapshotBySlug } from "@/common/utils/giftHistory";
import type { SlashCommandProps } from "commandkit";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("nowlive")
  .setDescription("Menampilkan daftar member yang sedang live");

export async function run({ interaction, client }: SlashCommandProps) {
  // TODO: enforce type with sqlite
  db.serialize(() => {
    db.all(
      `SELECT name AS member_name, username, slug, startLive AS start_live, 'IDN Live' AS platform, NULL AS room_url_key FROM idn_live
       UNION
       SELECT displayName AS member_name, NULL AS username, NULL AS slug, startLive AS start_live, 'Showroom' AS platform, room_url_key FROM showroom_live `,
      async (err, rows) => {
        if (err) {
          console.error("Failed to retrieve live members", err);
          return interaction.reply({
            content: "Gagal mengambil data member yang sedang live.",
            ephemeral: true,
          });
        }

        if (rows.length === 0) {
          const noliveEmbed = new EmbedBuilder()
            .setColor("#ff0000")
            .setAuthor({
              name: "JKT48 Live Information",
              iconURL: client.user.displayAvatarURL(),
            })
            .setTitle("List member yang sedang live")
            .setDescription("**Tidak ada member yang sedang live saat ini.**")
            .setFooter({ text: "Now Live | JKT48 Live Notification" });

          return interaction.reply({
            embeds: [noliveEmbed],
            ephemeral: true,
          });
        }

        const txt = "```";
        const extra = await liveSnapshotBySlug().catch(() => new Map());

        const description = rows
          .map((row: any) => {
            let link = "";
            if (row.platform === "IDN Live") {
              link = `https://www.idn.app/${row.username}/live/${row.slug}`;
            } else if (row.platform === "Showroom") {
              link = `https://www.showroom-live.com/r/${row.room_url_key}`;
            }
            const info = extra.get(row.slug);
            const stats = [
              typeof info?.viewCount === "number" ? `Penonton: ${info.viewCount.toLocaleString("id-ID")}` : "",
              info?.startedAt ? `Durasi: ${formatDuration(Date.now() - info.startedAt)}` : "",
            ]
              .filter(Boolean)
              .join("\n");
            return `${txt}Nama: ${row.member_name}\nStart Live: ${row.start_live}\nLive: ${row.platform}${stats ? `\n${stats}` : ""}${txt}\n[Tonton Live ${row.member_name}](${link})`;
          })
          .join("\n\n");

        const initialEmbed = new EmbedBuilder()
          .setColor("#ff0000")
          .setAuthor({
            name: "JKT48 Live Information",
            iconURL: client.user.displayAvatarURL(),
          })
          .setTitle("List member yang sedang live")
          .setDescription(description)
          .setFooter({ text: "Now Live | JKT48 Live Notification" });

        interaction.reply({ embeds: [initialEmbed], ephemeral: true });
      },
    );
  });
}
