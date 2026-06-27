import crypto from "node:crypto";
import axios from "axios";
import WebSocket from "ws";
import db from "./db";

/**
 * Love-letter capture for IDN Live.
 *
 * IDN delivers the end-of-stream "love letter" (sent by the idol to her top-3
 * gifters) as a message on its IRC-over-WebSocket chat (wss://chat.idn.app).
 * There is NO REST endpoint for it, so the only way to capture it is to be
 * joined to the room when it fires.
 *
 * This module is intentionally NOT a chat logger: it joins the room and ignores
 * every comment / gift / join — it only reacts to `letter` messages, stores
 * them in SQLite, and disconnects shortly after the live ends.
 */

const CHAT_WS_URL = "wss://chat.idn.app/";
// Capabilities the IDN web client requests — we mirror them for fidelity.
const CAP_REQ =
  "account-notify account-tag away-notify batch cap-notify chghost echo-message " +
  "extended-join invite-notify labeled-response message-tags multi-prefix server-time " +
  "setname userhost-in-names";
// Keep listening this long after a member drops off the live list — the love
// letters fire right at stream end, so we need a grace window.
const GRACE_MS = 150_000;
const RECONNECT_MS = 5_000;

export interface LiveMember {
  uuid: string;
  username: string;
  name: string;
  slug: string;
}

export interface LoveLetterRecord {
  letter_id: string;
  member_uuid: string;
  member_username: string;
  member_name: string;
  slug: string;
  recipient_name: string;
  recipient_username: string;
  recipient_uuid: string;
  rank: number;
  rank_label: string;
  message: string;
  created_at: number;
}

function randomNick(): string {
  return `idn-${crypto.randomBytes(16).toString("hex")}-web`;
}

/** Fetch the live page once and read chat_room_id from __NEXT_DATA__. */
async function fetchChatRoomId(username: string, slug: string): Promise<string | null> {
  try {
    const url = `https://www.idn.app/${username}/live/${slug}`;
    const res = await axios.get<string>(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      responseType: "text",
      timeout: 20_000,
    });
    const m = res.data.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (!m) return null;
    const data = JSON.parse(m[1]);
    return data?.props?.pageProps?.livestream?.chat_room_id ?? null;
  } catch (error) {
    console.error(`[loveletter] failed to fetch chat_room_id for ${username}:`, (error as Error).message);
    return null;
  }
}

function storeLoveLetter(rec: LoveLetterRecord) {
  db.run(
    `INSERT OR IGNORE INTO love_letters
      (letter_id, member_uuid, member_username, member_name, slug,
       recipient_name, recipient_username, recipient_uuid, rank, rank_label, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rec.letter_id,
      rec.member_uuid,
      rec.member_username,
      rec.member_name,
      rec.slug,
      rec.recipient_name,
      rec.recipient_username,
      rec.recipient_uuid,
      rec.rank,
      rec.rank_label,
      rec.message,
      rec.created_at,
    ],
    (err) => {
      if (err) console.error("[loveletter] failed to store letter:", err.message);
    },
  );
}

/** Pull the JSON out of an IRC PRIVMSG line and return a love letter, or null. */
function parseLoveLetter(line: string, member: LiveMember): LoveLetterRecord | null {
  const idx = line.indexOf(" PRIVMSG #");
  if (idx === -1) return null;
  const jsonStart = line.indexOf(" :", idx);
  if (jsonStart === -1) return null;
  const payload = line.slice(jsonStart + 2);
  if (!payload.startsWith("{") || !payload.includes('"letter"')) return null;

  let obj: any;
  try {
    obj = JSON.parse(payload);
  } catch {
    return null;
  }
  const letter = obj?.letter;
  if (!letter?.letter_id || !letter?.recipient) return null;

  const streamer = obj.user ?? {};
  const rankSlug: string = letter.type?.slug ?? "";
  const rankNum = Number.parseInt(rankSlug.replace(/[^0-9]/g, ""), 10);

  return {
    letter_id: letter.letter_id,
    member_uuid: streamer.uuid ?? member.uuid,
    member_username: streamer.username ?? member.username,
    member_name: streamer.name ?? member.name,
    slug: obj.room_id ?? member.slug,
    recipient_name: letter.recipient.name ?? "",
    recipient_username: letter.recipient.username ?? "",
    recipient_uuid: letter.recipient.uuid ?? "",
    rank: Number.isNaN(rankNum) ? 0 : rankNum,
    rank_label: letter.type?.name ?? "",
    message: letter.message ?? "",
    created_at: Math.floor(Date.now() / 1000),
  };
}

/** One IRC connection bound to a single live room. */
class LetterConnection {
  private ws: WebSocket | null = null;
  private nick = randomNick();
  private channel: string | null = null;
  private closing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    public member: LiveMember,
    private onLetter: (rec: LoveLetterRecord) => void,
  ) {}

  async start() {
    this.channel = await fetchChatRoomId(this.member.username, this.member.slug);
    if (!this.channel) {
      console.error(`[loveletter] no chat_room_id for ${this.member.username}; cannot watch.`);
      return;
    }
    this.connect();
  }

  private connect() {
    if (this.closing) return;
    this.nick = randomNick();
    const ws = new WebSocket(CHAT_WS_URL, { headers: { Origin: "https://www.idn.app" } });
    this.ws = ws;

    ws.on("open", () => {
      this.send("CAP LS 302");
      this.send(`NICK ${this.nick}`);
      this.send(`USER ${this.nick} 0 * null`);
    });

    ws.on("message", (data) => {
      for (const line of data.toString().split(/\r?\n/)) {
        if (line) this.handleLine(line);
      }
    });

    ws.on("close", () => {
      if (!this.closing) {
        this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_MS);
      }
    });
    ws.on("error", (err) => {
      console.error(`[loveletter] ws error (${this.member.username}):`, (err as Error).message);
    });
  }

  private handleLine(line: string) {
    if (line.startsWith("PING")) {
      this.send(line.replace(/^PING/, "PONG"));
      return;
    }
    // CAP LS response -> request caps then finish negotiation
    if (/ CAP \S+ LS /.test(line)) {
      this.send(`CAP REQ :${CAP_REQ}`);
      this.send("CAP END");
      return;
    }
    // welcome -> join the room and register presence (mirrors the web client)
    if (/ 001 /.test(line) && this.channel) {
      this.send(`JOIN #${this.channel}`);
      const presence = JSON.stringify({
        room_identifier: this.channel,
        user_identifier: this.nick.replace(/^idn-|-web$/g, ""),
        join_at: Math.floor(Date.now() / 1000),
        created_at: Math.floor(Date.now() / 1000),
        is_login: false,
      });
      this.send(`PRIVMSG IDNHeimdall :JOINED ${presence}`);
      return;
    }
    // the only thing we care about: a love letter
    const rec = parseLoveLetter(line, this.member);
    if (rec) {
      console.log(`[loveletter] 💌 ${rec.member_name} -> ${rec.recipient_name} (${rec.rank_label})`);
      this.onLetter(rec);
    }
  }

  private send(line: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(line);
  }

  stop() {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

/** Opens/closes connections to match the set of members currently live. */
export class LoveLetterManager {
  private active = new Map<string, LetterConnection>();
  private graceTimers = new Map<string, NodeJS.Timeout>();

  /** Reconcile live members: open watchers for new lives, grace-close ended ones. */
  sync(liveMembers: LiveMember[]) {
    const liveByUuid = new Map(liveMembers.map((m) => [m.uuid, m]));

    for (const m of liveMembers) {
      // member is live again within grace -> cancel pending close
      const t = this.graceTimers.get(m.uuid);
      if (t) {
        clearTimeout(t);
        this.graceTimers.delete(m.uuid);
      }
      if (!this.active.has(m.uuid)) {
        const conn = new LetterConnection(m, storeLoveLetter);
        this.active.set(m.uuid, conn);
        conn.start();
        console.log(`[loveletter] watching ${m.username} for love letters`);
      }
    }

    // members no longer live -> schedule a grace-period close
    for (const uuid of this.active.keys()) {
      if (!liveByUuid.has(uuid) && !this.graceTimers.has(uuid)) {
        const timer = setTimeout(() => {
          this.active.get(uuid)?.stop();
          this.active.delete(uuid);
          this.graceTimers.delete(uuid);
          console.log(`[loveletter] stopped watching ${uuid} (live ended)`);
        }, GRACE_MS);
        this.graceTimers.set(uuid, timer);
      }
    }
  }
}
