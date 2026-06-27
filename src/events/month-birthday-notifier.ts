import { readFile } from "node:fs";
import axios from "axios";
import { type Client, EmbedBuilder, TextChannel } from "discord.js";
import schedule from "node-schedule";

import type { Member } from "@/commands/schedule";
import { CONFIG } from "@/common/utils/constants";
import db from "@/common/utils/db";
import { type ParsedBirthday, parseBirthday } from "@/common/utils/memberBirthday";

let membersData: Member[] = [];
readFile("member.json", "utf8", (err, data) => {
  if (err) {
    console.error("❗ Error reading member data:", err);
    return;
  }
  membersData = JSON.parse(data);
});

const monthNames = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function getBirthdaysThisMonth() {
  const today = new Date();
  const currentMonth = today.getMonth(); // 0-11
  const currentYear = today.getFullYear();

  return membersData
    .map((member) => {
      const parsed = parseBirthday(member);
      if (!parsed) {
        console.warn(`❗ Birthday not found for member: ${member.name}`);
      }
      return parsed;
    })
    .filter((b): b is ParsedBirthday => b !== null && b.monthIndex === currentMonth)
    .map((b) => ({
      name: b.name,
      date: b.raw,
      year: b.year,
      age: currentYear - b.year,
    }));
}

async function sendMonthBirthdayNotifications(client: Client) {
  const today = new Date();
  if (today.getDate() === 1) {
    const birthdays = getBirthdaysThisMonth();
    if (birthdays.length > 0) {
      const embed = new EmbedBuilder()
        .setTitle(
          `Selamat Pagi, Berikut adalah member yang berulang tahun pada bulan ${monthNames[today.getMonth()]}! 🎉`,
        )
        .setColor("#ff0000")
        .setFooter({ text: "Birthday Announcement JKT48" });

      birthdays.forEach(({ name, date, year, age }) => {
        embed.addFields({
          name: name,
          value: `${date} (${age} tahun)`,
        });
      });

      // Ambil channel_id dari database
      db.all("SELECT guild_id, channel_id FROM schedule_id", async (err, scheduleRows: any[]) => {
        if (err) {
          console.error("❗ Error retrieving schedule channels:", err);
          return;
        }

        if (scheduleRows.length === 0) {
          console.log("❗ Tidak ada channel schedule yang terdaftar.");
          return;
        }

        const handledGuilds = new Set();

        for (const { guild_id, channel_id } of scheduleRows) {
          try {
            const channel = await client.channels.fetch(channel_id);
            if (channel && channel instanceof TextChannel) {
              await channel.send({ embeds: [embed] });
              handledGuilds.add(guild_id);
            } else {
              console.log(`❗ Channel dengan ID ${channel_id} tidak ditemukan.`);
            }
          } catch (error) {
            const err = error as Error;
            console.error(`❗ Gagal mengirim pengumuman ke channel ${channel_id}: ${err.message}`);
          }
        }

        // Send to whitelisted channels
        db.all("SELECT channel_id FROM whitelist", async (err, whitelistRows: any[]) => {
          if (err) {
            console.error("❗ Error retrieving whitelist channels:", err);
            return;
          }

          for (const { channel_id } of whitelistRows) {
            try {
              const channel = await client.channels.fetch(channel_id);
              if (channel && channel instanceof TextChannel && !handledGuilds.has(channel.guild.id)) {
                await channel.send({ embeds: [embed] });
              }
            } catch (error) {
              const err = error as Error;
              console.error(`❗ Gagal mengirim pengumuman ke channel ${channel_id}: ${err.message}`);
            }
          }
        });
      });

      // Send to webhooks
      db.all("SELECT url FROM webhook", async (err, webhookRows: any[]) => {
        if (err) {
          console.error("❗ Error retrieving webhook URLs:", err.message);
          return;
        }

        if (webhookRows.length === 0) {
          return null;
        }

        for (const webhook of webhookRows) {
          try {
            await axios.post(webhook.url, {
              content: null,
              embeds: [embed.toJSON()],
              username: CONFIG.webhook.name,
              avatar_url: CONFIG.webhook.avatar,
            });
          } catch (error) {
            const err = error as Error;
            console.error(`❗ Gagal mengirim notifikasi ke webhook ${webhook.url}: ${err.message}`);
          }
        }
      });
    }
  }
}

export default function (client: Client) {
  schedule.scheduleJob("0 7 * * *", () => {
    sendMonthBirthdayNotifications(client);
  });
}
