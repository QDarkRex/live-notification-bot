import { readFile } from "node:fs";
import type { Member } from "@/commands/schedule";
import type { ParsedSchedule } from "@/common/utils/calendar";
import { CONFIG } from "@/common/utils/constants";
import db from "@/common/utils/db";
import { env } from "@/common/utils/envConfig";
import axios from "axios";
import { type Client, EmbedBuilder, TextChannel } from "discord.js";

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

async function sendScheduleNotifications(client: Client) {
  const whitelistedChannels = (await getWhitelistedChannels()) as [];
  const prioritizedChannels = (await getPrioritizedChannels()) as [];

  const channelsToNotify = prioritizedChannels.length > 0 ? prioritizedChannels : whitelistedChannels;

  if (!channelsToNotify || channelsToNotify.length === 0) {
    console.error("No whitelisted channels found.");
    return;
  }

  const schedules = await fetchSchedules();
  if (!schedules || schedules.length === 0) {
    return null;
  }

  let hasNewSchedules = false;
  const embed = new EmbedBuilder().setColor("#ff0000").setTitle("Berikut adalah jadwal event yang akan datang.");

  const fields = [];

  const nowYear = new Date().getFullYear();

  for (const schedule of schedules) {
    const { tanggal, hari, bulan, events } = schedule;

    if (events.length > 0) {
      const event = events[0];
      const { eventName, eventUrl } = event;

      const existsInDatabase = await checkEventExists(eventName);
      if (existsInDatabase) {
        return;
      }

      fields.push({
        name: eventName,
        value: `🗓️ ${hari}, ${tanggal} ${bulan} ${nowYear}\n🔗 Detail: [Klik disini](https://jkt48.com/${eventUrl})`,
        inline: false,
      });

      await saveEventToDatabase(eventName);
      hasNewSchedules = true;

      break;
    }
  }

  if (hasNewSchedules) {
    embed.addFields(fields);

    for (const channelId of channelsToNotify) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel && channel instanceof TextChannel) {
          try {
            await channel.send({ embeds: [embed] });
          } catch (error) {
            const err = error as Error;
            console.error(`Error sending to channel ${channelId}:`, err.message);
          }
        }
      } catch (error) {
        console.error(`Failed to fetch channel ${channelId}`, error);
      }
    }

    db.all("SELECT url FROM webhook", async (err, webhookRows: any[]) => {
      if (err) {
        console.error("❗ Error retrieving webhook URLs:", err.message);
        return;
      }
      if (webhookRows.length === 0) {
        return null;
      }
      // Send to each webhook
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

    console.log("❗ Jadwal baru telah dikirim.");
  } else {
    return null;
  }
}

async function fetchSchedules() {
  try {
    const response = await axios.get<ParsedSchedule[]>(`http://${env.HOST}:${env.PORT}/schedule/section`);
    return response.data;
  } catch (error) {
    return null;
  }
}

async function getWhitelistedChannels() {
  return new Promise((resolve, reject) => {
    db.all("SELECT channel_id FROM whitelist", (err, rows) => {
      if (err) {
        console.error("Failed to retrieve whitelisted channels", err);
        return reject(err);
      }
      resolve(rows.map((row: any) => row.channel_id));
    });
  });
}

async function checkEventExists(eventName: string) {
  return new Promise((resolve, reject) => {
    db.get("SELECT 1 FROM events WHERE eventName = ? LIMIT 1", [eventName], (err, row) => {
      if (err) {
        console.error("Error checking event existence:", err);
        return reject(err);
      }
      resolve(!!row);
    });
  });
}

async function saveEventToDatabase(eventName: string) {
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        eventName TEXT
      )`,
    );

    db.run("INSERT INTO events (eventName) VALUES (?)", [eventName], (err) => {
      if (err) {
        console.error("❗ Gagal menyimpan event baru", err);
      } else {
        console.log(`❗ Event ${eventName} berhasil disimpan!`);
      }
    });
  });
}

async function getPrioritizedChannels() {
  return new Promise((resolve, reject) => {
    // TODO: enforce type
    db.all("SELECT channel_id FROM schedule_id", (err, rows) => {
      if (err) {
        console.error("Failed to retrieve prioritized channels", err);
        return reject(err);
      }
      resolve(rows.map((row: any) => row.channel_id));
    });
  });
}

export default function (client: Client): void {
  setInterval(() => sendScheduleNotifications(client), 30000);
}
