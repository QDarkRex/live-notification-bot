import db from "@/common/utils/db";
import { env } from "@/common/utils/envConfig";
import type { SlashCommandProps } from "commandkit";
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("loveletter")
  .setDescription("(Admin) Lihat love letter yang tersimpan dari live IDN")
  .addStringOption((o) =>
    o.setName("member").setDescription("Filter nama/username member (opsional)").setRequired(false),
  )
  .addIntegerOption((o) =>
    o.setName("limit").setDescription("Jumlah love letter terbaru (default 10)").setRequired(false),
  );

interface LetterRow {
  member_name: string;
  recipient_name: string;
  rank_label: string;
  message: string;
  slug: string;
  created_at: number;
}

export async function run({ interaction }: SlashCommandProps) {
  // Owner-only, and only the owner can see the result.
  if (interaction.user.id !== env.OWNER_ID) {
    return interaction.reply({
      content: "Perintah ini hanya untuk admin.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const member = interaction.options.getString("member");
  const limit = Math.min(Math.max(interaction.options.getInteger("limit") ?? 10, 1), 25);

  const where = member ? "WHERE member_name LIKE ? OR member_username LIKE ?" : "";
  const params: (string | number)[] = member ? [`%${member}%`, `%${member}%`] : [];
  params.push(limit);

  db.all(
    `SELECT member_name, recipient_name, rank_label, message, slug, created_at
     FROM love_letters ${where}
     ORDER BY created_at DESC
     LIMIT ?`,
    params,
    (err, rows: LetterRow[]) => {
      if (err) {
        console.error("[loveletter] query failed:", err.message);
        return interaction.reply({
          content: "Gagal mengambil data love letter.",
          flags: MessageFlags.Ephemeral,
        });
      }
      if (!rows.length) {
        return interaction.reply({
          content: member ? `Belum ada love letter tersimpan untuk "${member}".` : "Belum ada love letter tersimpan.",
          flags: MessageFlags.Ephemeral,
        });
      }

      const description = rows
        .map((r) => {
          const date = new Date(r.created_at * 1000).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
          return `**${r.member_name}** → **${r.recipient_name}** _(${r.rank_label})_\n> ${r.message}\n\`${date}\``;
        })
        .join("\n\n")
        .slice(0, 4000);

      const embed = new EmbedBuilder()
        .setColor("#ff0000")
        .setTitle(member ? `Love Letter — ${member}` : "Love Letter Tersimpan")
        .setDescription(description)
        .setFooter({ text: `Menampilkan ${rows.length} love letter | JKT48 Live Notification` });

      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  );
}
