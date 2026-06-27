import { readFile } from "node:fs";
import axios from "axios";
import schedule from "node-schedule";

import type { Member } from "@/commands/schedule";
import type { ParsedSchedule, Schedule } from "@/common/utils/calendar";
import { CONFIG } from "@/common/utils/constants";
import db from "@/common/utils/db";
import { env } from "@/common/utils/envConfig";
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

async function fetchShowSchedule() {
  try {
    const response = await axios.get<Schedule[]>(`http://${env.HOST}:${env.PORT}/schedule`);
    return response.data;
  } catch (error) {
    return null;
  }
}

async function fetchEventSchedule() {
  try {
    const response = await axios.get<ParsedSchedule[]>(`http://${env.HOST}:${env.PORT}/schedule/section`);
    return response.data;
  } catch (error) {
    console.error("Error fetching event schedule:", error);
    return null;
  }
}

const monthNames = ["Jan", "Feb", "Mar", "Apr", "Mei", "Juni", "Juli", "Agt", "Sept", "Okt", "Nov", "Des"];

const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

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

function createCombinedEmbed(
  showSchedules: Schedule[],
  events: ParsedSchedule[],
  totalShows: number,
  totalEvents: number,
) {
  const waktu = getTimeOfDay(new Date().getHours());

  const title =
    totalShows === 0 && totalEvents > 0
      ? `Selamat ${waktu}.. Hari ini ada ${totalEvents} event!`
      : totalEvents === 0 && totalShows > 0
        ? `Selamat ${waktu}.. Hari ini ada ${totalShows} show!`
        : totalEvents === 0 && totalShows === 0
          ? `Selamat ${waktu}.. Tidak ada show atau event hari ini.`
          : `Selamat ${waktu}.. Hari ini ada ${totalShows} show dan ${totalEvents} event!`;

  const embed = new EmbedBuilder().setTitle(title).setColor("#ff0000");

  if (showSchedules.length > 0) {
    let showDescriptions = "**Jadwal Show:**\n";
    showSchedules.forEach((schedule) => {
      const showInfoParts = schedule.showInfo.split("Show");
      const datePart = showInfoParts[0].trim();
      const timePart = showInfoParts[1] ? showInfoParts[1].trim() : "TBD";

      const dateParts = datePart.split(", ")[1].split(".");
      const scheduleDate = new Date(
        Number(dateParts[2]),
        Number.parseInt(dateParts[1], 10) - 1,
        Number.parseInt(dateParts[0], 10),
      );
      const formattedDate = `${dayNames[scheduleDate.getDay()]} ${Number.parseInt(
        dateParts[0],
        10,
      )} ${monthNames[Number.parseInt(dateParts[1], 10) - 1]} ${dateParts[2]}`;

      const birthday = schedule.birthday || "";
      const memberNicknames = schedule.members.map(getNickname).join(", ");

      showDescriptions += `- **${schedule.setlist}** \n🕒 ${timePart} \n🗓️ ${formattedDate}${
        birthday ? ` \n🎂 ${birthday}` : ""
      }${memberNicknames ? ` \n👥 ${memberNicknames}` : ""}\n`;
    });
    embed.setDescription(showDescriptions);
  }

  if (events.length > 0) {
    events.forEach((event) => {
      const eventDescription = event.events
        .map((e) => {
          const date = new Date();
          const dateEvent = event.tanggal;
          const dayName = event.hari;
          const monthName = event.bulan;
          const year = date.getFullYear();

          return `**${e.eventName}**\n🗓️ ${dayName}, ${dateEvent} ${monthName} ${year}\n🔗 Detail: [Klik disini](http://jkt48.com${e.eventUrl})`;
        })
        .join("\n\n");
      embed.addFields({
        name: "Event pada hari ini!",
        value: eventDescription,
      });
    });
  }

  embed.setFooter({ text: "Jadwal dan Event JKT48 | JKT48 Live Notification" });
  return embed;
}

async function sendTodayCombinedNotifications(client: Client) {
  const [showSchedules, eventSchedules] = await Promise.all([fetchShowSchedule(), fetchEventSchedule()]);

  if (!showSchedules || !eventSchedules) {
    console.log("❗ Gagal mengambil data jadwal atau event.");
    return;
  }

  const today = new Date();
  const todayString = `${today.getDate()}.${today.getMonth() + 1}.${today.getFullYear()}`;

  const todayShows = showSchedules.filter((schedule) => {
    const scheduleDate = schedule.showInfo.split(", ")[1].split("Show")[0].trim();
    return scheduleDate === todayString;
  });

  const filteredTodayEvents = eventSchedules.filter(
    (event) => event.tanggal === today.getDate().toString() && event.bulan === monthNames[today.getMonth()],
  );

  const totalShows = todayShows.length;
  const totalEvents = filteredTodayEvents.reduce((acc, event) => acc + event.events.length, 0);

  if (totalShows === 0 && totalEvents === 0) {
    console.log("❗ Tidak ada jadwal show atau event hari ini.");
    return;
  }

  const embed = createCombinedEmbed(todayShows, filteredTodayEvents, totalShows, totalEvents);

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

export default function (client: Client) {
  schedule.scheduleJob("0 7 * * *", () => sendTodayCombinedNotifications(client));
}
