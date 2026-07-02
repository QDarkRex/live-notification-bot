import { readFile } from "node:fs";
import axios from "axios";
import { type Client, EmbedBuilder, TextChannel } from "discord.js";
import schedule from "node-schedule";

import type { Member } from "@/commands/schedule";
import type { Schedule } from "@/common/utils/calendar";
import { CONFIG } from "@/common/utils/constants";
import db from "@/common/utils/db";
import { env } from "@/common/utils/envConfig";

let membersData: Member[] = [];
readFile("member.json", "utf8", (err, data) => {
  if (err) {
    console.error("Error reading member data:", err);
    return;
  }
  membersData = JSON.parse(data);
});

function getNickname(name: string) {
  const member = membersData.find((m) => m.name === name);
  return member?.nicknames[0] ?? name;
}

async function fetchShowSchedule() {
  try {
    const response = await axios.get<Schedule[]>(`http://${env.HOST}:${env.PORT}/schedule`);
    return response.data;
  } catch (error) {
    return null;
  }
}

async function sendFifteenMinuteNotifications(client: Client) {
  const showSchedules = await fetchShowSchedule();
  if (!showSchedules) {
    console.log("❗ Gagal mengambil data jadwal show.");
    return;
  }

  const now = new Date();
  const fifteenMinutesFromNow = new Date(now.getTime() + 15 * 60000);

  const formattedNow = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;

  const upcomingShows = showSchedules.filter((schedule) => {
    const scheduleDate = schedule.showInfo.split(", ")[1].split("Show")[0].trim();
    const scheduleTime = schedule.showInfo.split("Show")[1].trim();
    const [hours, minutes] = scheduleTime.split(":").map(Number);
    const showStartTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);

    return scheduleDate === formattedNow && showStartTime <= fifteenMinutesFromNow && showStartTime > now;
  });

  if (upcomingShows.length === 0) {
    return;
  }

  function getTimeOfDay(hour: number) {
    if (hour >= 0 && hour < 7) {
      return "Subuh";
    } else if (hour >= 7 && hour < 10) {
      return "Pagi";
    } else if (hour >= 10 && hour < 15) {
      return "Siang";
    } else if (hour >= 15 && hour < 18) {
      return "Sore";
    } else {
      return "Malam";
    }
  }

  const waktu = getTimeOfDay(new Date().getHours());

  const embed = new EmbedBuilder()
    .setTitle(`Selamat ${waktu}.. Sudah siapkah kalian menonton show hari ini? Show akan dimulai dalam 15 menit!`)
    .setColor("#ff0000");

  const showDescriptions = "";

  upcomingShows.forEach((schedule) => {
    const memberNicknames = schedule.members
      .map(getNickname)
      .filter((nickname) => nickname)
      .join(", ");

    const birthdayMembers = (schedule.birthday || [])
      .filter((name) => membersData.some((m) => m.name === name))
      .join(", ");

    const time = schedule.showInfo.split("Show")[1].trim();
    const day = formattedNow.split(".")[0];
    const monthIndex = Number.parseInt(formattedNow.split(".")[1], 10) - 1;
    const year = formattedNow.split(".")[2];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Juni", "Juli", "Agt", "Sept", "Okt", "Nov", "Des", "Des"];
    const monthName = monthNames[monthIndex];

    embed.addFields({
      name: schedule.setlist,
      value:
        `🕒 ${time}\n🗓️ ${day} ${monthName} ${year}` +
        (birthdayMembers ? `\n🎂 ${birthdayMembers}` : "") +
        (memberNicknames ? `\n👥 ${memberNicknames}` : ""),
    });
  });

  embed.setDescription(showDescriptions || "**Jadwal Show**");
  embed.setFooter({ text: "Jadwal dan Event JKT48 | JKT48 Live Notification" });

  db.all("SELECT guild_id, channel_id FROM schedule_id", async (err, scheduleRows: any) => {
    if (err) {
      console.error("Error retrieving schedule channels:", err);
      return;
    }

    const handledGuilds = new Set();

    for (const { guild_id, channel_id } of scheduleRows) {
      try {
        const channel = await client.channels.fetch(channel_id);
        if (channel && channel instanceof TextChannel) {
          await channel.send({ embeds: [embed] });
          handledGuilds.add(guild_id);
        }
      } catch (error) {
        const err = error as Error;
        console.error(`Gagal mengirim pengumuman ke channel ${channel_id}: ${err.message}`);
      }
    }

    db.all("SELECT channel_id FROM whitelist", async (err, whitelistRows: any[]) => {
      if (err) {
        console.error("Error retrieving whitelist channels:", err);
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
          console.error(`Gagal mengirim pengumuman ke channel ${channel_id}: ${err.message}`);
        }
      }
    });

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
  });
}

export default function (client: Client) {
  schedule.scheduleJob("*/15 * * * *", () => sendFifteenMinuteNotifications(client));
}
