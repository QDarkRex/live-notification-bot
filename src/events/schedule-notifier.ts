import { readFile } from "node:fs";
import axios from "axios";

import type { Member } from "@/commands/schedule";
import type { Schedule } from "@/common/utils/calendar";
import { CONFIG } from "@/common/utils/constants";
import db from "@/common/utils/db";
import { env } from "@/common/utils/envConfig";
import { type Channel, type Client, EmbedBuilder, TextChannel } from "discord.js";

let membersData: Member[] = [];
readFile("member.json", "utf8", (err, data) => {
  if (err) {
    console.error("❗ Error reading member data:", err);
    return;
  }
  membersData = JSON.parse(data);
});

function getNickname(name: string) {
  const member = membersData.find((m) => m.name === name);
  return member && member.nicknames.length > 0 ? member.nicknames[0] : null;
}

async function sendScheduleNotifications(client: Client) {
  const whitelistedChannels = (await getWhitelistedChannels()) as any[];
  const scheduleChannels = (await getScheduleChannels()) as any[];

  if (
    (!whitelistedChannels || whitelistedChannels.length === 0) &&
    (!scheduleChannels || scheduleChannels.length === 0)
  ) {
    console.error("❗ No whitelisted channels found.");
    return;
  }

  const schedules = await fetchSchedules();
  if (!schedules || schedules.length === 0) {
    return null;
  }

  let hasNewSchedules = false;
  const embed = new EmbedBuilder().setColor("#ff0000").setFooter({ text: "JKT48 Live Notification" });

  const fields = [];

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Juni", "Juli", "Agt", "Sept", "Okt", "Nov", "Des"];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let anyFieldHasMembers = false;

  for (const schedule of schedules) {
    const existsInDatabase = await checkScheduleExists(schedule.showInfo, schedule.members);
    if (existsInDatabase) {
      continue;
    }

    const showInfoParts = schedule.showInfo.split("Show");
    const dateTime = showInfoParts[0].trim();
    const time = showInfoParts[1].trim();

    const dateParts = dateTime.split(", ");
    if (dateParts.length < 2) {
      console.error("❗ Invalid date format:", dateTime);
      continue;
    }

    const dayAndMonthYear = dateParts[1].split(".");
    if (dayAndMonthYear.length < 3) {
      console.error("❗ Invalid date format:", dateParts[1]);
      continue;
    }

    const day = dayAndMonthYear[0].trim();
    const monthIndex = Number.parseInt(dayAndMonthYear[1], 10) - 1;
    const year = dayAndMonthYear[2].trim();

    // Always save to DB so past shows are never re-sent
    await saveScheduleToDatabase(schedule.setlist, schedule.showInfo, schedule.members);

    // Skip shows that have already passed
    const showDate = new Date(Number(year), monthIndex, Number(day));
    if (showDate < today) {
      continue;
    }

    const monthName = monthNames[monthIndex];
    const memberNicknames = schedule.members
      .map(getNickname)
      .filter((nickname) => nickname)
      .join(", ");

    const birthday = schedule.birthday || "";

    if (memberNicknames) anyFieldHasMembers = true;

    fields.push({
      name: schedule.setlist,
      value: `🕒 ${time}\n🗓️ ${day} ${monthName} ${year}${
        birthday ? `\n🎂 ${birthday}` : ""
      }${memberNicknames ? `\n👥 ${memberNicknames}` : ""}`,
      inline: false,
    });

    hasNewSchedules = true;
  }

  if (hasNewSchedules) {
    embed.setTitle(
      anyFieldHasMembers
        ? "Berikut adalah list member yang akan tampil pada show yang akan datang."
        : "Berikut adalah jadwal show yang akan datang.",
    );
  }

  if (hasNewSchedules) {
    embed.addFields(fields);

    const handledGuilds = new Set();

    for (const { guild_id, channel_id } of scheduleChannels) {
      const channel = await fetchChannel(client, channel_id);
      if (channel) {
        await sendEmbed(channel, embed);
        handledGuilds.add(guild_id);
      }
    }

    for (const channelId of whitelistedChannels) {
      const channel = await fetchChannel(client, channelId);
      if (channel && channel instanceof TextChannel && !handledGuilds.has(channel.guild.id)) {
        await sendEmbed(channel, embed);
      }
    }

    console.log("❗ Jadwal baru telah berhasil dikirim.");

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
  } else {
    return null;
  }
}

async function fetchSchedules() {
  try {
    const response = await axios.get<Schedule[]>(`http://${env.HOST}:${env.PORT}/schedule`);
    return response.data;
  } catch (error) {
    return null;
  }
}

async function getWhitelistedChannels() {
  return new Promise((resolve, reject) => {
    db.all("SELECT channel_id FROM whitelist", (err, rows: any[]) => {
      if (err) {
        console.error("Failed to retrieve whitelisted channels", err);
        return reject(err);
      }
      resolve(rows.map((row) => row.channel_id));
    });
  });
}

async function getScheduleChannels() {
  return new Promise((resolve, reject) => {
    db.all("SELECT guild_id, channel_id FROM schedule_id", (err, rows) => {
      if (err) {
        console.error("Failed to retrieve schedule channels", err);
        return reject(err);
      }
      resolve(rows);
    });
  });
}

async function checkScheduleExists(showInfo: string, members: string[]) {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT 1 FROM theater_schedule WHERE showInfo = ? AND members = ? LIMIT 1",
      [showInfo, members.join(", ")],
      (err, row) => {
        if (err) {
          console.error("Error checking schedule existence:", err);
          return reject(err);
        }
        resolve(!!row);
      },
    );
  });
}

async function saveScheduleToDatabase(setlist: string, showInfo: string, members: string[]) {
  const createdAt = new Date().toISOString();
  db.run(
    "INSERT INTO theater_schedule (setlist, showInfo, members, created_at) VALUES (?, ?, ?, ?)",
    [setlist, showInfo, members.join(", "), createdAt],
    (err) => {
      if (err) {
        console.error("Failed to insert new schedule", err);
      } else {
        console.log(`❗ Schedule ${setlist} berhasil disimpan di theater_schedule!`);
      }
    },
  );
}

async function getExistingSchedulesFromDatabase() {
  return new Promise((resolve, reject) => {
    db.all("SELECT showInfo, members FROM theater_schedule", (err, rows: any[]) => {
      if (err) {
        console.error("Failed to retrieve existing schedules", err);
        return reject(err);
      }
      resolve(
        rows.map((row) => ({
          showInfo: row.showInfo,
          members: row.members.split(", "),
        })),
      );
    });
  });
}

async function fetchChannel(client: Client, channelId: string) {
  try {
    return await client.channels.fetch(channelId);
  } catch (error) {
    console.error(`Failed to fetch channel ${channelId}:`, error);
    return null;
  }
}

async function sendEmbed(channel: Channel, embed: EmbedBuilder) {
  if (channel instanceof TextChannel) {
    try {
      await channel.send({ embeds: [embed] });
    } catch (error) {
      const err = error as Error;
      console.error(`Error sending embed to channel ${channel.id}:`, err.message);
    }
  }
}

async function deleteOldSchedules() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const formattedDate = sevenDaysAgo.toISOString();

  db.run("DELETE FROM theater_schedule WHERE created_at < ?", [formattedDate], (err) => {
    if (err) {
      console.error("Failed to delete old schedules", err);
    } else {
      console.log("Old schedules successfully deleted.");
    }
  });
}

setInterval(deleteOldSchedules, 24 * 60 * 60 * 1000);

export default function (client: Client) {
  setInterval(() => sendScheduleNotifications(client), 60000);
}
