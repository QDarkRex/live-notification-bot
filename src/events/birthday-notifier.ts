import { readFile } from "node:fs";
import axios from "axios";
import { ActionRowBuilder, ButtonBuilder, type Client, EmbedBuilder, TextChannel } from "discord.js";
import schedule from "node-schedule";

import type { Member } from "@/commands/schedule";
import { CONFIG } from "@/common/utils/constants";
import db from "@/common/utils/db";
import { memberProfileUrl, membersBirthdayToday } from "@/common/utils/memberBirthday";

/** Local view of a member with a birthday today, derived from member.json. */
interface Birthday {
  name: string;
  birthday: string; // "6 Agustus 2008"
  profileLink: string; // absolute URL (social) or ""
  imgSrc: string;
}

let membersData: Member[] = [];
readFile("member.json", "utf8", (err, data) => {
  if (err) {
    console.error("❗ Error reading member data:", err);
    return;
  }
  membersData = JSON.parse(data);
});

/**
 * Today's birthdays, computed from the bundled member.json (the jkt48.com
 * birthday widget is no longer scrapeable after the Nuxt rewrite).
 */
function getTodaysBirthdays(): Birthday[] {
  return membersBirthdayToday(membersData).map((b) => {
    const member = membersData.find((m) => m.name === b.name);
    return {
      name: b.name,
      birthday: b.raw,
      profileLink: member ? memberProfileUrl(member) : "",
      imgSrc: member?.img_alt ?? "",
    };
  });
}

function createBirthdayEmbed(member: Birthday) {
  const memberData = membersData.find((m) => m.name === member.name);
  const imgAlt = memberData ? memberData.img_alt : member.imgSrc;

  const birthYear = Number(member.birthday.split(" ").pop() || 0);
  const currentYear = new Date().getFullYear();
  const age = currentYear - birthYear;

  const embed = new EmbedBuilder()
    .setTitle("Ada Member Yang Sedang Ulang Tahun Hari Ini!!")
    .setImage(imgAlt)
    .setDescription(
      `Selamat Ulang Tahun **${member.name}**!! 🎉🎉\nSedang berulang tahun ke-**${age}**\n\n**🎂 Nama:** ${member.name}\n**📅 Birthdate:** ${member.birthday}\n**🎉 Umur:** ${age}\n\nHappy birthdayy 🎉🎉\nWish You All The Best!!`,
    )
    .setColor("#ff0000")
    .setFooter({
      text: "Birthday Announcement JKT48 | JKT48 Live Notification",
    });
  return embed;
}

/** Profile button, only when we have a valid absolute URL. */
function memberButton(member: Birthday): ActionRowBuilder<ButtonBuilder> | null {
  if (!member.profileLink.startsWith("http")) return null;

  const button = new ButtonBuilder().setLabel("Profile Member").setURL(member.profileLink).setStyle(5);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

async function sendBirthdayNotifications(client: Client) {
  const todayBirthdays = getTodaysBirthdays();

  if (todayBirthdays.length === 0) {
    return null;
  }

  db.serialize(() => {
    db.all("SELECT guild_id, channel_id FROM schedule_id", async (err, scheduleRows: any[]) => {
      if (err) {
        console.error("❗ Error retrieving schedule channels:", err);
        return;
      }

      const handledGuilds = new Set();

      for (const { guild_id, channel_id } of scheduleRows) {
        try {
          const channel = await client.channels.fetch(channel_id);
          if (channel && channel instanceof TextChannel) {
            for (const member of todayBirthdays) {
              const embed = createBirthdayEmbed(member);
              const buttons = memberButton(member);
              await channel.send({
                embeds: [embed],
                components: buttons ? [buttons] : [],
              });
              handledGuilds.add(guild_id);
            }
          } else {
            console.log(`❗ Channel dengan ID ${channel_id} tidak ditemukan.`);
          }
        } catch (error) {
          const err = error as Error;
          console.error(`❗ Gagal mengirim pengumuman ke channel ${channel_id}: ${err.message}`);
        }
      }

      db.all("SELECT channel_id FROM whitelist", async (err, whitelistRows: any[]) => {
        if (err) {
          console.error("❗ Error retrieving whitelist channels:", err);
          return;
        }

        for (const { channel_id } of whitelistRows) {
          try {
            const channel = await client.channels.fetch(channel_id);
            if (channel && channel instanceof TextChannel && !handledGuilds.has(channel.guild.id)) {
              for (const member of todayBirthdays) {
                const embed = createBirthdayEmbed(member);
                const buttons = memberButton(member);
                await channel.send({
                  embeds: [embed],
                  components: buttons ? [buttons] : [],
                });
              }
            }
          } catch (error) {
            const err = error as Error;
            console.error(`❗ Gagal mengirim pengumuman ke channel ${channel_id}: ${err.message}`);
          }
        }
      });
    });
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
      for (const member of todayBirthdays) {
        const embed = createBirthdayEmbed(member);
        const buttons = memberButton(member);
        try {
          await axios.post(webhook.url, {
            content: null,
            embeds: [embed.toJSON()],
            components: buttons ? [buttons.toJSON()] : [],
            username: CONFIG.webhook.name,
            avatar_url: CONFIG.webhook.avatar,
          });
        } catch (error) {
          const err = error as Error;
          console.error(`❗ Gagal mengirim notifikasi ke webhook ${webhook.url}: ${err.message}`);
        }
      }
    }
  });
}

export default function (client: Client) {
  schedule.scheduleJob("0 0 * * *", () => {
    sendBirthdayNotifications(client);
  });
}
