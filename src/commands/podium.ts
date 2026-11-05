import { findStreamer } from "@/commands/supporter";
import { BEST_SUPPORTER_EVENT } from "@/common/utils/constants";
import { wibDate } from "@/common/utils/giftPeriods";
import { activeMemberUuids, finishedSessions, firstTrackedDay, knownStreamers } from "@/common/utils/giftTracker";
import { aggregateOverall, aggregatePodium, aggregateTop3Counts } from "@/common/utils/podiumStats";
import type { SlashCommandProps } from "commandkit";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

const periods = [
  { name: "7 hari", value: "7" },
  { name: "30 hari", value: "30" },
  { name: "event Best Supporter", value: "event" },
] as const;

const modes = [
  { name: "per member", value: "member" },
  { name: "overall", value: "overall" },
  { name: "top-3 counts", value: "top3" },
] as const;

export const data = new SlashCommandBuilder()
  .setName("podium")
  .setDescription("Perkiraan Gold untuk podium #1–#3 di live member")
  .addStringOption((o) => o.setName("member").setDescription("Nama panggilan member").setRequired(false))
  .addStringOption((o) =>
    o
      .setName("periode")
      .setDescription("Rentang waktu")
      .setRequired(false)
      .addChoices(...periods),
  )
  .addStringOption((o) =>
    o
      .setName("mode")
      .setDescription("Tampilan: per member (default), overall, atau jumlah top-3")
      .setRequired(false)
      .addChoices(...modes),
  );

const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
const dayStart = (day: string) => Date.parse(`${day}T00:00:00+07:00`);

export async function run({ interaction }: SlashCommandProps) {
  await interaction.deferReply();
  try {
    const period = interaction.options.getString("periode") ?? "30";
    const now = Date.now();
    let since: number;
    let end: number;
    let label: string;
    if (period === "event") {
      since = dayStart(BEST_SUPPORTER_EVENT.start);
      end = Math.min(dayStart(BEST_SUPPORTER_EVENT.end) + 24 * 3600_000, now + 1);
      label = BEST_SUPPORTER_EVENT.label;
    } else {
      const days = Number(period);
      since = now - days * 24 * 3600_000;
      end = now + 1;
      label = `${days} hari`;
    }
    const members = activeMemberUuids();
    const names = (await knownStreamers()).filter((s) => members.has(s.uuid));
    const selected = interaction.options.getString("member");
    const streamer = selected ? findStreamer(names, selected) : undefined;
    if (selected && !streamer) return interaction.editReply({ content: `Member "${selected}" tidak ditemukan.` });
    const sessions = (await finishedSessions(since)).filter(
      (s) => s.started_at < end && members.has(s.streamer_uuid) && (!streamer || s.streamer_uuid === streamer.uuid),
    );
    const mode = interaction.options.getString("mode") ?? "member";
    const stats = aggregatePodium(sessions);
    const footerSince = await firstTrackedDay();
    const footer = `Jendela ${wibDate(since)}–${wibDate(Math.max(since, end - 1))} WIB • dihitung dari live yang tercatat bot sejak ${footerSince ?? "belum ada data"}; perkiraan`;

    let description: string;
    let title = `🏆 Podium Supporter — ${streamer?.name ?? label}`;
    if (mode === "overall") {
      const memberNames = new Map(names.map((s) => [s.uuid, s.name]));
      const overall = aggregateOverall(sessions).slice(0, 15);
      title = `🏆 Leaderboard Overall — ${streamer?.name ?? label}`;
      description =
        overall
          .map(
            (s, i) =>
              `**${i + 1}. ${memberNames.get(s.uuid) ?? "?"}** — ${fmt(s.totalGold)} Gold • ${s.lives} live • rata-rata ${fmt(s.averageGold)} Gold/live (≈ Rp${fmt(Math.round(s.totalGold * 2500))})`,
          )
          .join("\n") || "Belum ada live selesai yang memenuhi syarat.";
    } else if (mode === "top3") {
      const top = aggregateTop3Counts(sessions).slice(0, 15);
      title = `🏆 Sering Masuk Top 3 — ${streamer?.name ?? label}`;
      description =
        top
          .map(
            (s, i) =>
              `**${i + 1}. ${s.name.slice(0, 40)}** — ${s.top3}× top 3 (🥇${s.firsts} 🥈${s.seconds} 🥉${s.thirds}) • ${fmt(s.gold)} Gold`,
          )
          .join("\n") || "Belum ada live selesai yang memenuhi syarat (minimal 3 gifter per live).";
    } else if (streamer) {
      const stat = stats.find((s) => s.uuid === streamer.uuid);
      description = stat
        ? `**${stat.lives} live** dihitung (minimal 3 gifter per live; estimasi Rp2.500/Gold)\n${stat.ranked.map((g) => `**#${g.rank}** — rata-rata ${fmt(g.averageGold)} Gold (min ${fmt(g.minGold)}, maks ${fmt(g.maxGold)}; ≈ Rp${fmt(Math.round(g.averageGold * 2500))})`).join("\n")}\n\nPodium live terbaru: ${stat.latest.map((g, i) => `#${i + 1} ${g.name.slice(0, 100)} (${fmt(g.gold)} Gold)`).join(" • ")}`
        : `Belum ada live selesai yang memenuhi syarat (${label}).`;
    } else {
      const memberNames = new Map(names.map((s) => [s.uuid, s.name]));
      description =
        stats
          .slice(0, 15)
          .map(
            (s, i) =>
              `**${i + 1}. ${memberNames.get(s.uuid) ?? "?"}** — rata-rata #1 ${fmt(s.ranked[0]?.averageGold ?? 0)} Gold/live (${s.lives} live)`,
          )
          .join("\n") || "Belum ada live selesai yang memenuhi syarat.";
    }
    const embed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle(title)
      .setDescription(description)
      .setFooter({ text: footer });
    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error building podium:", error);
    return interaction.editReply({ content: "Terjadi kesalahan saat mengambil data podium." });
  }
}
