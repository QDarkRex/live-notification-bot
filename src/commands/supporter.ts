import type { SlashCommandProps } from "commandkit";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

import { BEST_SUPPORTER_EVENT } from "@/common/utils/constants";
import {
  type Streamer,
  activeMemberUuids,
  firstTrackedDay,
  knownStreamers,
  streamerSupporters,
  streamerTotals,
} from "@/common/utils/giftTracker";

export const data = new SlashCommandBuilder()
  .setName("supporter")
  .setDescription("Gold IDN Live per member selama event Best Supporter")
  .addStringOption((option) =>
    option
      .setName("member")
      .setDescription("Nama panggilan member, misal: Aralie. Kosongkan untuk peringkat semua member.")
      .setRequired(false),
  );

const fmt = (n: number) => n.toLocaleString("id-ID");

function findStreamer(streamers: Streamer[], query: string): Streamer | undefined {
  const q = query
    .trim()
    .toLowerCase()
    .replace(/^jkt48[_-]/, "");
  const exact = streamers.find(
    (s) =>
      s.name.toLowerCase() === q ||
      s.username.toLowerCase().replace(/^jkt48[_-]/, "") === q ||
      s.fullName?.toLowerCase() === q,
  );
  return (
    exact ??
    streamers.find((s) => s.name.toLowerCase().startsWith(q) || s.fullName?.toLowerCase().split(" ").includes(q))
  );
}

async function footerText(): Promise<string> {
  const since = await firstTrackedDay();
  const start = since && since > BEST_SUPPORTER_EVENT.start ? since : BEST_SUPPORTER_EVENT.start;
  return `Dicatat bot sejak ${start} • perkiraan, angka resmi tetap dari IDN Live`;
}

export async function run({ interaction }: SlashCommandProps) {
  await interaction.deferReply();
  try {
    const { start, end, label } = BEST_SUPPORTER_EVENT;
    const memberUuids = activeMemberUuids();
    const streamers = (await knownStreamers()).filter((streamer) => memberUuids.has(streamer.uuid));
    const query = interaction.options.getString("member");

    if (!query) {
      const names = new Map(streamers.map((s) => [s.uuid, s.name]));
      const totals = (await streamerTotals(start, end)).filter((t) => memberUuids.has(t.streamer_uuid) && t.gold > 0);
      const lines = totals
        .slice(0, 25)
        .map(
          (t, i) =>
            `**${i + 1}. ${names.get(t.streamer_uuid) ?? "?"}** — ${fmt(t.gold)} Gold (${fmt(t.supporters)} supporter)`,
        );
      const embed = new EmbedBuilder()
        .setColor("#ff0000")
        .setTitle(`💰 Gold IDN Live per Member (${label})`)
        .setDescription(lines.length > 0 ? lines.join("\n") : "Belum ada gift yang tercatat.")
        .setFooter({ text: `${await footerText()} | /supporter member:<nama> untuk top supporter` });
      return interaction.editReply({ embeds: [embed] });
    }

    const streamer = findStreamer(streamers, query);
    if (!streamer) {
      return interaction.editReply({
        content: `Member "${query}" tidak ditemukan. Pakai nama panggilan, misal: Aralie.`,
      });
    }

    const supporters = await streamerSupporters(streamer.uuid, start, end);
    const total = supporters.reduce((sum, s) => sum + s.gold, 0);
    const lines = supporters
      .slice(0, 10)
      .map((s, i) => `${i < 3 ? "🦺" : "🧢"} **${i + 1}. ${s.name}** — ${fmt(s.gold)} Gold (${fmt(s.point)} Point)`);

    const embed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle(`🏆 Best Supporter — ${streamer.name}`)
      .setDescription(
        supporters.length > 0
          ? `Total **${fmt(total)} Gold** dari ${fmt(supporters.length)} supporter (${label})\n\n${lines.join("\n")}`
          : `Belum ada gift yang tercatat untuk ${streamer.name} (${label}).`,
      )
      .setFooter({ text: `🦺 Top 3: Vest + Postcard • 🧢 Top 10: Topi\n${await footerText()}` });
    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error building supporter leaderboard:", error);
    return interaction.editReply({ content: "Terjadi kesalahan saat mengambil data supporter." });
  }
}
