import db from "@/common/utils/db";
import { type GifterTotal, rankGifters, wibDate } from "@/common/utils/giftPeriods";
import type { LiveMember } from "@/common/utils/idnChat";

export interface ChatGiftEvent {
  streamer_uuid: string;
  slug: string;
  msgid: string;
  event_at: number;
  received_at: number;
  day: string;
  gifter_uuid: string;
  gifter_name: string;
  gold: number;
  point: number;
}

const GIFT_SENDER = "IDNOdin!IDNOdin@serverop.idn.app";

function invalidGift(reason: string): null {
  console.warn(`[gift-chat] ignored invalid gift event: ${reason}`);
  return null;
}

/** Parse a gift broadcast only when its IRC source, room and streamer match this watcher. */
export function parseChatGift(
  line: string,
  member: LiveMember,
  channel: string,
  receivedAt = Date.now(),
): ChatGiftEvent | null {
  const match = /^(?:@([^ ]+) )?:([^ ]+) PRIVMSG #([^ ]+) :(.*)$/.exec(line);
  if (!match) return null;
  const [, rawTags, sender, actualChannel, payloadText] = match;
  const isGiftSender = sender === GIFT_SENDER;
  let payload: any;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return isGiftSender && actualChannel === channel ? invalidGift("malformed JSON") : null;
  }
  if (!payload || !payload.gift) return null;
  if (!isGiftSender) return invalidGift("unexpected sender");
  if (actualChannel !== channel) return invalidGift("unexpected room channel");
  if (payload.room_id !== member.slug) return invalidGift("room slug mismatch");
  if (
    typeof member.uuid !== "string" ||
    !member.uuid.trim() ||
    typeof payload.user?.uuid !== "string" ||
    !payload.user.uuid.trim() ||
    (payload.user.name !== undefined && typeof payload.user.name !== "string")
  )
    return invalidGift("missing gifter identity");

  const tags = new Map(
    (rawTags ?? "").split(";").map((tag) => {
      const i = tag.indexOf("=");
      return i < 0 ? [tag, ""] : [tag.slice(0, i), tag.slice(i + 1)];
    }),
  );
  const msgid = tags.get("msgid") ?? "";
  const time = tags.get("time") ?? "";
  const eventAt = Date.parse(time);
  if (!msgid.trim()) return invalidGift("missing msgid");
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(time) || !Number.isFinite(eventAt))
    return invalidGift("missing or invalid server time");
  const { gold, point } = payload.gift;
  if (
    !Number.isSafeInteger(gold) ||
    gold < 0 ||
    !Number.isSafeInteger(point) ||
    point < 0 ||
    (gold === 0 && point === 0)
  )
    return invalidGift("invalid gold or point values");

  return {
    streamer_uuid: member.uuid,
    slug: member.slug,
    msgid,
    event_at: eventAt,
    received_at: receivedAt,
    day: wibDate(eventAt),
    gifter_uuid: payload.user.uuid,
    gifter_name: payload.user.name?.trim() || payload.user.uuid,
    gold,
    point,
  };
}

function insert(event: ChatGiftEvent): Promise<boolean> {
  return new Promise((resolve, reject) =>
    db.run(
      `INSERT INTO gift_chat_events
        (streamer_uuid, slug, msgid, event_at, received_at, day, gifter_uuid, gifter_name, gold, point)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (streamer_uuid, slug, msgid) DO NOTHING`,
      [
        event.streamer_uuid,
        event.slug,
        event.msgid,
        event.event_at,
        event.received_at,
        event.day,
        event.gifter_uuid,
        event.gifter_name,
        event.gold,
        event.point,
      ],
      function (err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      },
    ),
  );
}

/** Durable insert with bounded retries for cross-connection SQLITE_BUSY races. */
export async function recordChatGift(event: ChatGiftEvent): Promise<boolean> {
  if (
    typeof event.streamer_uuid !== "string" ||
    !event.streamer_uuid.trim() ||
    typeof event.slug !== "string" ||
    !event.slug.trim() ||
    typeof event.msgid !== "string" ||
    !event.msgid.trim() ||
    typeof event.gifter_uuid !== "string" ||
    !event.gifter_uuid.trim() ||
    typeof event.gifter_name !== "string" ||
    !event.gifter_name.trim() ||
    !Number.isSafeInteger(event.event_at) ||
    !Number.isSafeInteger(event.received_at) ||
    event.day !== wibDate(event.event_at) ||
    !Number.isSafeInteger(event.gold) ||
    event.gold < 0 ||
    !Number.isSafeInteger(event.point) ||
    event.point < 0 ||
    (event.gold === 0 && event.point === 0)
  ) {
    console.warn("[gift-chat] refused invalid ledger event");
    return false;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      return await insert(event);
    } catch (error) {
      if ((error as { code?: string }).code !== "SQLITE_BUSY" || attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}

export function ingestChatGift(line: string, member: LiveMember, channel: string): Promise<boolean> {
  const event = parseChatGift(line, member, channel);
  return event ? recordChatGift(event) : Promise.resolve(false);
}

async function sessionWrite(sql: string, params: unknown[], context: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));
      return;
    } catch (error) {
      if ((error as { code?: string }).code !== "SQLITE_BUSY" || attempt >= 5) {
        console.error(`[gift-chat] failed to update session ${context}:`, error);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}

const sessionQueues = new Map<string, Promise<void>>();

function enqueueSessionWrite(member: LiveMember, sql: string, params: unknown[], context: string) {
  const key = `${member.uuid}:${member.slug}`;
  const previous = sessionQueues.get(key) ?? Promise.resolve();
  const next = previous.then(() => sessionWrite(sql, params, context));
  sessionQueues.set(key, next);
  void next.then(() => {
    if (sessionQueues.get(key) === next) sessionQueues.delete(key);
  });
  return next;
}

export function noteChatSocketOpen(member: LiveMember, _at: number) {
  return enqueueSessionWrite(
    member,
    `INSERT INTO gift_chat_sessions
      (streamer_uuid, slug, username, first_attached_at, last_attached_at, connect_count, disconnect_count)
     VALUES (?, ?, ?, NULL, NULL, 1, 0)
     ON CONFLICT (streamer_uuid, slug) DO UPDATE SET username = excluded.username, connect_count = connect_count + 1`,
    [member.uuid, member.slug, member.username],
    `${member.username} connect`,
  );
}

export function noteChatAttached(member: LiveMember, at: number) {
  return enqueueSessionWrite(
    member,
    `UPDATE gift_chat_sessions SET
       first_attached_at = COALESCE(first_attached_at, ?),
       last_attached_at = ? WHERE streamer_uuid = ? AND slug = ?`,
    [at, at, member.uuid, member.slug],
    `${member.username} attach`,
  );
}

export function noteUnexpectedChatDisconnect(member: LiveMember, _at: number) {
  return enqueueSessionWrite(
    member,
    "UPDATE gift_chat_sessions SET disconnect_count = disconnect_count + 1 WHERE streamer_uuid = ? AND slug = ?",
    [member.uuid, member.slug],
    `${member.username} disconnect`,
  );
}

type GiftRow = { gifter_uuid: string; gifter_name: string; gold: number; point: number };

function all<T>(sql: string, params: unknown[]): Promise<T[]> {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))),
  );
}

/** Uncapped per-gifter gift total for one exact live session. */
export async function chatSessionTotals(slug: string, streamerUuid: string): Promise<GifterTotal[]> {
  const rows = await all<GiftRow>(
    `SELECT gifter_uuid, MAX(gifter_name) AS gifter_name, SUM(gold) AS gold, SUM(point) AS point
     FROM gift_chat_events WHERE slug = ? AND streamer_uuid = ? GROUP BY gifter_uuid`,
    [slug, streamerUuid],
  );
  return rankGifters(
    rows.map((row) => ({ uuid: row.gifter_uuid, name: row.gifter_name, gold: row.gold, point: row.point })),
  );
}

/** Uncapped per-gifter total for one streamer on a server-event WIB day. */
export async function chatDailyTotals(streamerUuid: string, day: string): Promise<GifterTotal[]> {
  const rows = await all<GiftRow>(
    `SELECT gifter_uuid, MAX(gifter_name) AS gifter_name, SUM(gold) AS gold, SUM(point) AS point
     FROM gift_chat_events WHERE streamer_uuid = ? AND day = ? GROUP BY gifter_uuid`,
    [streamerUuid, day],
  );
  return rankGifters(
    rows.map((row) => ({ uuid: row.gifter_uuid, name: row.gifter_name, gold: row.gold, point: row.point })),
  );
}
