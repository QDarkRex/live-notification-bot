import { scrapeGiftData } from "@/api/gift/giftService";
import { Member } from "@/commands/schedule";
import { CONFIG } from "@/common/utils/constants";
import db from "@/common/utils/db";
import axios from "axios";
import { type Client, EmbedBuilder, TextChannel } from "discord.js";

export interface Livestream {
  data: Data;
}

export interface Data {
  searchLivestream: SearchLivestream;
}

export interface SearchLivestream {
  next_cursor: null;
  result: Result[];
}

export interface Result {
  slug: string;
  title: string;
  image_url: string;
  view_count: number;
  playback_url: string;
  room_identifier: null;
  status: string;
  live_at: Date;
  end_at: null;
  scheduled_at: null;
  gift_icon_url: null;
  category: Category;
  creator: Creator;
}

export interface Category {
  name: string;
  slug: string;
}

export interface Creator {
  uuid: string;
  username: string;
  name: string;
  avatar: string;
  bio_description: string;
  following_count: number;
  follower_count: number;
  is_follow: boolean;
}

let liveStreams: Result[] = [];

async function fetchLiveStreams() {
  try {
    const response = await axios.post<Livestream>("https://api.idn.app/graphql", {
      query: `query SearchLivestream {
        searchLivestream(query: "", limit: 100) {
          next_cursor
          result {
            slug
            title
            image_url
            view_count
            playback_url
            room_identifier
            status
            live_at
            end_at
            scheduled_at
            gift_icon_url
            category {
              name
              slug
            }
            creator {
              uuid
              username
              name
              avatar
              bio_description
              following_count
              follower_count
              is_follow
            }
          }
        }
      }`,
    });
    return response.data.data.searchLivestream.result;
  } catch (error) {
    console.error("Failed to fetch IDN Lives");
    return null;
  }
}

function filterLiveStreams(streams: Result[]) {
  return streams.filter(
    (stream) =>
      stream.creator.username.startsWith("jkt48_") ||
      (stream.creator.username.startsWith("jkt48-") && stream.creator.name.endsWith("JKT48")),
  );
}

function parseEndTime(localeString: Date) {
  const date = new Date(localeString);
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
  const time = date.toLocaleTimeString("en-GB", options);
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear().toString().slice(-2);
  return `${time}/${day}/${month}/${year}`;
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

function parseStartTime(dateString: Date) {
  const date = new Date(dateString);
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hour = date.getHours().toString().padStart(2, "0");
  const minute = date.getMinutes().toString().padStart(2, "0");
  return {
    formatted: `${hour}:${minute}/${day}/${month}/${year}`,
    hour: date.getHours(),
  };
}

const nameReplacements = [
  { original: "Fiony", replacement: "Cepio❤️❤️" },
  { original: "Adel", replacement: "Dedel" },
  { original: "Gita", replacement: "Gita 🥶" },
  { original: "Gracia", replacement: "Ci Gre" },
  { original: "Lia", replacement: "Ci Lia" },
  { original: "Olla", replacement: "Olali" },
  { original: "Oniel", replacement: "Onyil" },
  { original: "Jessi", replacement: "Jeci" },
  { original: "Helisma", replacement: "Ceu Eli" },
  { original: "Indah", replacement: "Kak Indah" },
  { original: "Kathrina", replacement: "Atin" },
  { original: "Greesel", replacement: "Icel" },
  { original: "Cynthia", replacement: "Ciput❤️❤️" },
  { original: "Erine", replacement: "Erni" },
  { original: "Delynn", replacement: "Deyinn" },
  { original: "Feni", replacement: "Teh Mpen" },
  { original: "Freya", replacement: "Fureya" },
  { original: "Cathy", replacement: "Keti" },
  { original: "Oline", replacement: "Oyin" },
  { original: "Aralie", replacement: "Ayayi" },
  { original: "Christy", replacement: "Kiti" },
  { original: "Callie", replacement: "Keli" },
  { original: "Flora", replacement: "Mplorr" },
  { original: "Gracie", replacement: "Ecarg" },
  { original: "Muthe", replacement: "Mumuchang" },
  { original: "Nayla", replacement: "Nayra" },
  { original: "Regie", replacement: "Reji" },
];

function replaceName(name: string) {
  for (const { original, replacement } of nameReplacements) {
    if (name.includes(original)) {
      return name.replace(original, replacement);
    }
  }
  return name;
}

function createEmbed(stream: Result) {
  const { formatted: startLive, hour: startHour } = parseStartTime(stream.live_at);
  const waktu = getTimeOfDay(startHour);
  const followerCount = stream.creator.follower_count || 0;
  const replacedName = replaceName(stream.creator.name);

  const embed = new EmbedBuilder()
    .setColor("#ff0000")
    .setImage(stream.image_url)
    .setAuthor({
      name: `Selamat ${waktu}, ${stream.creator.name.split(" ")[0]} Sedang Live IDN nih!`,
      iconURL: stream.creator.avatar,
    })
    .setDescription(`**${replacedName.split(" JKT48").join("")}** lagi live cuy!\nYuk Ditonton..`)
    .addFields(
      { name: "Judul", value: stream.title, inline: true },
      { name: "Start Live", value: startLive, inline: true },
      { name: "Followers", value: `${followerCount}`, inline: true },
      {
        name: "Tonton di Browser!",
        value: `[Multi Stream](https://dc.crstlnz.my.id/multi) | [Embed Stream](https://www.idn.app/embed/${stream.slug})`,
        inline: true,
      },
      {
        name: "Tonton di IDN Web!",
        value: `[IDN Web](https://www.idn.app/${stream.creator.username}/live/${stream.slug})`,
        inline: true,
      },
      {
        name: "​",
        value: `\`${stream.slug}\``,
        inline: false,
      },
    )
    .setFooter({
      text: "IDNLive JKT48 | JKT48 Live Notification",
    });
  return embed;
}

function createEndLiveEmbed(user: any) {
  const endLive = parseEndTime(new Date());
  const replacedName = replaceName(user.name);
  const follower_count = user.follower_count;
  const embed = new EmbedBuilder()
    .setColor("#ff0000")
    .setImage(user.image_url)
    .setAuthor({
      name: `${user.name.split(" ")[0].trim()} Baru Saja Selesai Live IDN!`,
      iconURL: user.avatar,
    })
    .setDescription(`Live IDN **${replacedName.split(" JKT48")}** telah berakhir.`)
    .addFields(
      { name: "Start Live", value: user.startLive, inline: true },
      { name: "End Live", value: endLive, inline: true },
      {
        name: "Followers",
        value: `${follower_count}`,
        inline: true,
      },
      {
        name: "​",
        value: `\`${user.slug}\``,
        inline: false,
      },
    )
    .setFooter({
      text: "IDNLive JKT48 | JKT48 Live Notification",
    });
  return embed;
}

async function updateTopGifts(uuid: string) {
  try {
    const topGifts = await scrapeGiftData(uuid);
    db.serialize(() => {
      db.run("DELETE FROM top_gifts WHERE uuid = ?", [uuid]);
      const stmt = db.prepare(
        "INSERT INTO top_gifts (uuid, rank, name, total_gold, total_point) VALUES (?, ?, ?, ?, ?)",
      );
      topGifts.forEach((gift) => {
        const totalGold = Number.parseInt(gift.gold.replace(" Gold", ""), 10);
        const totalPoint = Number.parseInt(gift.point.replace(" Point", ""), 10);
        stmt.run(uuid, gift.rank, gift.name, totalGold, totalPoint);
      });
      stmt.finalize();
    });
  } catch (error) {
    console.error("Failed to update top gifts", error);
  }
}

async function sendNotifications(client: Client) {
  const streams = await fetchLiveStreams();

  if (streams === null) {
    return;
  }

  liveStreams = filterLiveStreams(streams);

  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS idn_live (
        id INTEGER PRIMARY KEY, 
        user_id TEXT UNIQUE,
        username TEXT,
        name TEXT, 
        avatar TEXT, 
        image_url TEXT,
        slug TEXT,
        follower_count TEXT,
        startLive TEXT
      )`,
    );

    db.all(
      "SELECT user_id, username, name, avatar, image_url, slug, follower_count, startLive FROM idn_live",
      async (err, rows: any[]) => {
        if (err) {
          console.error("Failed to retrieve notified users", err);
          return;
        }

        const notifiedUsers = new Map(rows.map((row) => [row.user_id, row]));
        const newStreams = liveStreams.filter((stream) => !notifiedUsers.has(stream.creator.uuid));

        db.all("SELECT channel_id FROM whitelist", async (err, rows: any[]) => {
          if (err) {
            console.error("Failed to retrieve whitelisted channels", err);
            return;
          }
          const channelIds = rows.map((row) => row.channel_id);

          // Ambil URL webhook dari tabel webhook
          db.all("SELECT url FROM webhook", async (err, webhookRows: any[]) => {
            if (err) {
              console.error("Failed to retrieve webhooks", err);
              return;
            }
            const webhookUrls = webhookRows.map((row) => row.url);

            let notificationSent = false;

            for (const stream of newStreams) {
              console.log(`🔴 Member sedang live: ${stream.creator.name} (IDN Live)`);

              const embed = createEmbed(stream);
              updateTopGifts(stream.creator.uuid);
              for (const channelId of channelIds) {
                try {
                  const channel = await client.channels.fetch(channelId);
                  if (channel && channel instanceof TextChannel) {
                    db.get(
                      "SELECT role_id FROM tag_roles WHERE guild_id = ?",
                      [channel.guild.id],
                      async (err, row: any) => {
                        if (err) {
                          console.error("Database error:", err);
                          return;
                        }

                        let content = "";
                        if (row) {
                          content =
                            row.role_id === "everyone"
                              ? `@everyone ${stream.creator.name.split(" ")[0]} Sedang Live IDN nih!`
                              : `<@&${row.role_id}> ${stream.creator.name.split(" ")[0]} Sedang Live IDN nih!`;
                        }

                        try {
                          await channel.send({ content, embeds: [embed] });
                          notificationSent = true;
                        } catch (error) {
                          const err = error as any;
                          if (err.code === 50013 || err.code === 50001 || err.code === 10003) {
                            console.error(`❗ Missing permissions for channel ${channelId}. Removing from whitelist.`);
                            db.run("DELETE FROM whitelist WHERE channel_id = ?", [channelId], (err) => {
                              if (err) {
                                console.error("❗ Failed to delete channel from whitelist", err);
                              } else {
                                console.log(`❗ Channel ${channelId} removed from whitelist.`);
                              }
                            });
                          } else {
                            console.error(`❗ Announcement for channel ${channelId} failed. ${err}`);
                          }
                        }
                      },
                    );
                  }
                } catch (error) {
                  const err = error as any;
                  if (err.code === 50013 || err.code === 50001 || err.code === 10003) {
                    console.error(`❗ Missing permissions for channel ${channelId}. Removing from whitelist.`);
                    db.run("DELETE FROM whitelist WHERE channel_id = ?", [channelId], (err) => {
                      if (err) {
                        console.error("❗ Failed to delete channel from whitelist", err);
                      } else {
                        console.log(`❗ Channel ${channelId} removed from whitelist.`);
                      }
                    });
                  } else {
                    console.error(`❗ Announcement for channel ${channelId} failed. ${err}`);
                  }
                }
              }

              // Kirim embed ke setiap webhook
              for (const webhookUrl of webhookUrls) {
                try {
                  await axios.post(webhookUrl, {
                    content: null,
                    embeds: [embed.toJSON()],
                    username: CONFIG.webhook.name,
                    avatar_url: CONFIG.webhook.avatar,
                  });
                } catch (error) {
                  console.error(`❗ Failed to send embed to webhook ${webhookUrl}: ${error}`);
                }
              }

              db.run(
                "INSERT INTO idn_live (user_id, username, name, avatar, image_url, slug, follower_count, startLive) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                  stream.creator.uuid,
                  stream.creator.username,
                  stream.creator.name,
                  stream.creator.avatar,
                  stream.image_url,
                  stream.slug,
                  stream.creator.follower_count || 0,
                  parseStartTime(stream.live_at).formatted,
                ],
                (err) => {
                  if (err) {
                    console.error("❗ Failed to insert notified user", err);
                  }
                },
              );
            }

            const currentUserIds = new Set(liveStreams.map((stream) => stream.creator.uuid));
            const inactiveUsers = Array.from(notifiedUsers.values()).filter(
              (user) => !currentUserIds.has(user.user_id),
            );

            for (const user of inactiveUsers) {
              const embed = createEndLiveEmbed(user);
              db.all(
                "SELECT rank, name, total_gold, total_point FROM top_gifts WHERE uuid = ? ORDER BY rank LIMIT 10",
                [user.user_id],
                async (err, topGifts: any[]) => {
                  if (err) {
                    console.error("❗ Failed to retrieve top gifts", err);
                  } else {
                    const teks = "```";
                    const leftColumn = topGifts
                      .slice(0, 5)
                      .map(
                        (gift) => `${gift.rank}. ${gift.name}\n(${gift.total_gold} Gold) | (${gift.total_point} Point)`,
                      )
                      .join("\n");

                    const rightColumn = topGifts
                      .slice(5, 10)
                      .map(
                        (gift) => `${gift.rank}. ${gift.name}\n(${gift.total_gold} Gold) | (${gift.total_point} Point)`,
                      )
                      .join("\n");

                    embed.addFields(
                      {
                        name: "Top Gifters (1-5)",
                        value: `${teks}${leftColumn}${teks}` || "No gifters",
                        inline: true,
                      },
                      {
                        name: "Top Gifters (6-10)",
                        value: `${teks}${rightColumn}${teks}` || "No gifters",
                        inline: true,
                      },
                    );

                    for (const channelId of channelIds) {
                      try {
                        const channel = await client.channels.fetch(channelId);
                        if (channel && channel instanceof TextChannel) {
                          await channel.send({ embeds: [embed] });
                          db.run("DELETE FROM top_gifts WHERE uuid = ?", [user.user_id], (err) => {
                            if (err) {
                              console.error("❗ Failed to delete gift data", err);
                            }
                          });
                        }
                      } catch (error) {
                        const err = error as any;
                        if (err.code === 50013 || err.code === 50001 || err.code === 10003) {
                          console.error(`❗ Missing permissions for channel ${channelId}. Removing from whitelist.`);
                          db.run("DELETE FROM whitelist WHERE channel_id = ?", [channelId], (err) => {
                            if (err) {
                              console.error("❗ Failed to delete channel from whitelist", err);
                            } else {
                              console.log(`❗ Channel ${channelId} removed from whitelist.`);
                            }
                          });
                        } else {
                          console.error(`❗ Failed to send end live notification to channel ${channelId}: ${err}`);
                        }
                      }
                    }
                  }
                },
              );

              // Kirim embed end live ke setiap webhook
              for (const webhookUrl of webhookUrls) {
                try {
                  await axios.post(webhookUrl, {
                    content: null,
                    embeds: [embed.toJSON()],
                    username: CONFIG.webhook.name,
                    avatar_url: CONFIG.webhook.avatar,
                  });
                } catch (error) {
                  console.error(`❗ Failed to send end live embed to webhook ${webhookUrl}: ${error}`);
                }
              }

              db.run("DELETE FROM idn_live WHERE user_id = ?", [user.user_id], (err) => {
                if (err) {
                  console.error("❗ Failed to delete inactive user ID", err);
                } else {
                  console.log(`🔴 Live Member Telah Berakhir: ${user.name} (IDN Live)`);
                }
              });
            }
          });
        });
      },
    );
  });
}

setInterval(() => {
  liveStreams.forEach((stream) => updateTopGifts(stream.creator.uuid));
}, 15000);

export default function (client: Client) {
  setInterval(() => sendNotifications(client), 30000);
}
