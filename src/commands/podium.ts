import { findStreamer } from "@/commands/supporter";
import { BEST_SUPPORTER_EVENT } from "@/common/utils/constants";
import { wibDate } from "@/common/utils/giftPeriods";
import { activeMemberUuids, finishedSessions, firstTrackedDay, knownStreamers } from "@/common/utils/giftTracker";
import { aggregatePodium } from "@/common/utils/podiumStats";
import type { SlashCommandProps } from "commandkit";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

const periods = [
  { name: "7 hari", value: "7" },
  { name: "30 hari", value: "30" },
  { name: "event Best Supporter", value: "event" },
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
    const stats = aggregatePodium(sessions);
    const footerSince = await firstTrackedDay();
    const footer = `Jendela ${wibDate(since)}–${wibDate(Math.max(since, end - 1))} WIB • dihitung dari live yang tercatat bot sejak ${footerSince ?? "belum ada data"}; perkiraan`;

    let description: string;
    if (streamer) {
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
      .setTitle(`🏆 Podium Supporter — ${streamer?.name ?? label}`)
      .setDescription(description)
      .setFooter({ text: footer });
    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error building podium:", error);
    return interaction.editReply({ content: "Terjadi kesalahan saat mengambil data podium." });
  }
}
