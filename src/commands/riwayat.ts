import { findStreamer } from "@/commands/supporter";
import { type HistoryEntry, recentSessions } from "@/common/utils/giftHistory";
import { activeMemberUuids, knownStreamers } from "@/common/utils/giftTracker";
import type { SlashCommandProps } from "commandkit";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("riwayat")
  .setDescription("Riwayat live IDN terakhir beserta podium gifter")
  .addStringOption((o) => o.setName("member").setDescription("Nama panggilan member").setRequired(false))
  .addIntegerOption((o) =>
    o
      .setName("jumlah")
      .setDescription("Jumlah live (default 5, maks 10)")
      .setMinValue(1)
      .setMaxValue(10)
      .setRequired(false),
  );

const fmt = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 0 });
const GOLD_RUPIAH = 2500;

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h} j ${minutes % 60} m` : `${minutes} m`;
}

export function formatWib(ms: number): string {
  const d = new Date(ms + 7 * 3600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)} ${d.slice(11, 16)} WIB`;
}

/** One embed line block for a finished live. */
export function formatEntry(entry: HistoryEntry, name: string): string {
  const total = entry.gifters.reduce((sum, g) => sum + g.gold, 0);
  const duration =
    entry.endedAt && entry.endedAt > entry.startedAt ? ` • ${formatDuration(entry.endedAt - entry.startedAt)}` : "";
  const head = `**${name}**${entry.title ? ` — ${entry.title.slice(0, 80)}` : ""}\n${formatWib(entry.startedAt)}${duration}`;
  const top = entry.gifters
    .slice(0, 3)
    .map((g, i) => `${["🥇", "🥈", "🥉"][i]} ${g.name.slice(0, 40)} (${fmt(g.gold)})`)
    .join(" • ");
  const sum = `${fmt(total)} Gold • ${fmt(entry.gifters.length)} gifter • ≈ Rp${fmt(total * GOLD_RUPIAH)}`;
  return `${head}\n${top || "Tidak ada gifter"}\n${sum}`;
}

export async function run({ interaction }: SlashCommandProps) {
  await interaction.deferReply();
  try {
    const members = activeMemberUuids();
    const names = (await knownStreamers()).filter((s) => members.has(s.uuid));
    const selected = interaction.options.getString("member");
    const streamer = selected ? findStreamer(names, selected) : undefined;
    if (selected && !streamer) return interaction.editReply({ content: `Member "${selected}" tidak ditemukan.` });
    const count = Math.min(10, Math.max(1, interaction.options.getInteger("jumlah") ?? 5));
    const entries = await recentSessions(count, { streamerUuid: streamer?.uuid, allowed: members });
    const nameOf = new Map(names.map((s) => [s.uuid, s.name]));
    // Discord rejects embed descriptions over 4096 chars: keep whole entries that fit.
    const blocks: string[] = [];
    let length = 0;
    for (const e of entries) {
      const block = formatEntry(e, nameOf.get(e.streamerUuid) ?? "?");
      if (length + block.length + 2 > 4000) break;
      blocks.push(block);
      length += block.length + 2;
    }
    const embed = new EmbedBuilder()
      .setColor("#ff0000")
      .setTitle(`📜 Riwayat Live IDN${streamer ? ` — ${streamer.name}` : ""}`)
      .setDescription(blocks.length > 0 ? blocks.join("\n\n") : "Belum ada live selesai yang tercatat.")
      .setFooter({ text: "Dihitung dari live yang tercatat bot • Rupiah = estimasi Rp2.500/Gold" });
    return interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("Error building riwayat:", error);
    return interaction.editReply({ content: "Terjadi kesalahan saat mengambil riwayat live." });
  }
}
