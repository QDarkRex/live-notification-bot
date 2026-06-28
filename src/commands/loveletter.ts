import db from "@/common/utils/db";
import { env } from "@/common/utils/envConfig";
import type { SlashCommandProps } from "commandkit";
import {
  ActionRowBuilder,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("loveletter")
  .setDescription("(Admin) Lihat love letter dari live IDN, per sesi live")
  .setDefaultMemberPermissions(0)
  .addStringOption((o) =>
    o.setName("member").setDescription("Filter nama/username member (opsional)").setRequired(false),
  )
  .addStringOption((o) =>
    o.setName("session").setDescription("Slug sesi live tertentu (opsional, mis. hai-260627235347)").setRequired(false),
  );

interface SessionRow {
  slug: string;
  member_name: string;
  ts: number;
  n: number;
}
interface LetterRow {
  member_name: string;
  recipient_name: string;
  rank: number;
  rank_label: string;
  message: string;
  slug: string;
  created_at: number;
}

const fmt = (ts: number) =>
  new Date(ts * 1000).toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function dbAll<T>(sql: string, params: unknown[]): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[])));
  });
}

const LETTERS_SQL =
  "SELECT member_name, recipient_name, rank, rank_label, message, slug, created_at FROM love_letters WHERE slug = ? ORDER BY rank ASC";

function lettersEmbed(slug: string, rows: LetterRow[]) {
  const header = rows[0];
  const desc = rows
    .map((r) => `**#${r.rank} ${r.recipient_name}** _(${r.rank_label})_\n> ${r.message}`)
    .join("\n\n")
    .slice(0, 4000);
  return new EmbedBuilder()
    .setColor("#ff0000")
    .setTitle(`💌 ${header.member_name} — ${fmt(header.created_at)}`)
    .setDescription(desc || "—")
    .setFooter({ text: `Sesi: ${slug} • ${rows.length} love letter` });
}

export async function run({ interaction }: SlashCommandProps) {
  if (interaction.user.id !== env.OWNER_ID) {
    return interaction.reply({ content: "Perintah ini hanya untuk admin.", flags: MessageFlags.Ephemeral });
  }
  const member = interaction.options.getString("member");
  const session = interaction.options.getString("session");

  try {
    // 1) direct fetch of one specific session
    if (session) {
      const rows = await dbAll<LetterRow>(LETTERS_SQL, [session]);
      if (!rows.length) {
        return interaction.reply({
          content: `Tidak ada love letter untuk sesi \`${session}\`.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.reply({ embeds: [lettersEmbed(session, rows)], flags: MessageFlags.Ephemeral });
    }

    // 2) list sessions (optionally filtered by member)
    const where = member ? "WHERE member_name LIKE ? OR member_username LIKE ?" : "";
    const params = member ? [`%${member}%`, `%${member}%`] : [];
    const sessions = await dbAll<SessionRow>(
      `SELECT slug, member_name, MIN(created_at) AS ts, COUNT(*) AS n
       FROM love_letters ${where}
       GROUP BY slug ORDER BY ts DESC LIMIT 25`,
      params,
    );

    if (!sessions.length) {
      return interaction.reply({
        content: member ? `Belum ada love letter untuk "${member}".` : "Belum ada love letter tersimpan.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // only one session -> show it straight away
    if (sessions.length === 1) {
      const rows = await dbAll<LetterRow>(LETTERS_SQL, [sessions[0].slug]);
      return interaction.reply({ embeds: [lettersEmbed(sessions[0].slug, rows)], flags: MessageFlags.Ephemeral });
    }

    // multiple sessions -> dropdown to pick which live to fetch
    const menu = new StringSelectMenuBuilder()
      .setCustomId("ll_session")
      .setPlaceholder("Pilih sesi live untuk dilihat…")
      .addOptions(
        sessions.map((s) => ({
          label: `${s.member_name} — ${fmt(s.ts)}`.slice(0, 100),
          description: `${s.n} love letter • ${s.slug}`.slice(0, 100),
          value: s.slug,
        })),
      );
    const listEmbed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle(member ? `Sesi live — ${member}` : "Sesi live dengan love letter")
      .setDescription(
        sessions
          .map((s, i) => `**${i + 1}.** ${s.member_name} — ${fmt(s.ts)} _(${s.n} letter)_`)
          .join("\n")
          .slice(0, 4000),
      )
      .setFooter({ text: "Pilih sesi dari menu di bawah (berlaku 60 detik)" });

    const response = await interaction.reply({
      embeds: [listEmbed],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      flags: MessageFlags.Ephemeral,
    });

    try {
      const pick = await response.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: (i) => i.user.id === interaction.user.id,
        time: 60_000,
      });
      const rows = await dbAll<LetterRow>(LETTERS_SQL, [pick.values[0]]);
      await pick.update({ embeds: [lettersEmbed(pick.values[0], rows)], components: [] });
    } catch {
      await interaction.editReply({ components: [] }).catch(() => {});
    }
  } catch (err) {
    console.error("[loveletter] command error:", (err as Error).message);
    if (!interaction.replied) {
      await interaction.reply({ content: "Gagal mengambil data love letter.", flags: MessageFlags.Ephemeral });
    }
  }
}
