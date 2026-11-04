import crypto from "node:crypto";
import axios from "axios";
import WebSocket from "ws";
import { takeLines } from "./ircLines";

const CHAT_WS_URL = "wss://chat.idn.app/";
const CAP_REQ =
  "account-notify account-tag away-notify batch cap-notify chghost echo-message " +
  "extended-join invite-notify labeled-response message-tags multi-prefix server-time " +
  "setname userhost-in-names";
const GRACE_MS = 300_000;
const HEALTHY_RECONNECT_MS = 1_500;
const THROTTLE_MIN_MS = 60_000;
const THROTTLE_MAX_MS = 180_000;

export interface LiveMember {
  uuid: string;
  username: string;
  name: string;
  slug: string;
}

export interface ChatLifecycle {
  onOpen(member: LiveMember, at: number): void;
  onAttached(member: LiveMember, at: number): void;
  onUnexpectedDisconnect(member: LiveMember, at: number): void;
}

const NOOP_LIFECYCLE: ChatLifecycle = {
  onOpen: () => {},
  onAttached: () => {},
  onUnexpectedDisconnect: () => {},
};

async function fetchChatRoomId(username: string, slug: string): Promise<string | null> {
  try {
    const res = await axios.get<string>(`https://www.idn.app/${username}/live/${slug}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      responseType: "text",
      timeout: 20_000,
    });
    const m = res.data.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (!m) return null;
    const data = JSON.parse(m[1]);
    return data?.props?.pageProps?.livestream?.chat_room_id ?? null;
  } catch (error) {
    console.error(`[idnchat] failed to fetch chat_room_id for ${username}:`, (error as Error).message);
    return null;
  }
}

function randomNick(): string {
  return `idn-${crypto.randomBytes(8).toString("hex")}-web`;
}

class IdnChatConnection {
  private ws: WebSocket | null = null;
  private nick = randomNick();
  private channel: string | null = null;
  private closing = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private throttleDelay = THROTTLE_MIN_MS;
  private gotData = false;
  private lineBuffer = "";
  private attached = false;

  constructor(
    public member: LiveMember,
    private onLine: (line: string, member: LiveMember, channel: string) => void,
    private lifecycle: ChatLifecycle,
  ) {}

  async start() {
    for (let attempt = 1; attempt <= 6 && !this.closing && !this.channel; attempt++) {
      this.channel = await fetchChatRoomId(this.member.username, this.member.slug);
      if (this.channel) break;
      console.error(`[idnchat] no chat_room_id for ${this.member.username} (attempt ${attempt}/6); retrying in 15s...`);
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
    if (!this.channel) {
      console.error(`[idnchat] gave up fetching chat_room_id for ${this.member.username}; not watching.`);
      return;
    }
    this.connect();
  }

  private connect() {
    if (this.closing) return;
    this.nick = randomNick();
    this.lineBuffer = "";
    this.gotData = false;
    this.attached = false;
    const ws = new WebSocket(CHAT_WS_URL, {
      headers: {
        Origin: "https://www.idn.app",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    this.ws = ws;
    ws.on("open", () => {
      this.lifecycle.onOpen(this.member, Date.now());
      this.send("CAP LS 302");
      this.send(`NICK ${this.nick}`);
      this.send(`USER ${this.nick} 0 * null`);
    });
    ws.on("message", (data) => {
      const { lines, rest } = takeLines(this.lineBuffer, data.toString());
      this.lineBuffer = rest;
      for (const line of lines) {
        if (!this.gotData) {
          this.gotData = true;
          this.throttleDelay = THROTTLE_MIN_MS;
        }
        this.handleLine(line);
      }
    });
    ws.on("close", (code, reason) => {
      if (this.attached && !this.closing) this.lifecycle.onUnexpectedDisconnect(this.member, Date.now());
      if (this.closing) return;
      let delay: number;
      if (this.gotData) delay = HEALTHY_RECONNECT_MS;
      else {
        delay = this.throttleDelay;
        this.throttleDelay = Math.min(this.throttleDelay * 2, THROTTLE_MAX_MS);
      }
      const jittered = delay + Math.floor(Math.random() * 1_000);
      console.log(
        `[idnchat] ws dropped for ${this.member.username} (${this.member.slug}) - Code: ${code}, Reason: ${reason || "none"}, gotData: ${this.gotData}. Reconnecting in ${jittered}ms`,
      );
      this.reconnectTimer = setTimeout(() => this.connect(), jittered);
    });
    ws.on("error", (err) => console.error(`[idnchat] ws error (${this.member.username}):`, err.message));
  }

  private handleLine(line: string) {
    if (line.startsWith("PING")) {
      this.send(line.replace(/^PING/, "PONG"));
      return;
    }
    if (/ CAP \S+ LS /.test(line)) {
      this.send(`CAP REQ :${CAP_REQ}`);
      this.send("CAP END");
      return;
    }
    if (/ 001 /.test(line) && this.channel) {
      this.send(`JOIN #${this.channel}`);
      if (!this.attached) {
        this.attached = true;
        this.lifecycle.onAttached(this.member, Date.now());
      }
      const now = Math.floor(Date.now() / 1000);
      const presence = JSON.stringify({
        room_identifier: this.channel,
        user_identifier: this.nick.replace(/^idn-|-web$/g, ""),
        join_at: now,
        created_at: now,
        is_login: false,
      });
      this.send(`PRIVMSG IDNHeimdall :JOINED ${presence}`);
      return;
    }
    this.onLine(line, this.member, this.channel ?? "");
  }

  private send(line: string) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(`${line}\r\n`);
  }

  stop() {
    this.closing = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try {
      this.ws?.close();
    } catch {
      // Ignore a close racing with connection setup.
    }
  }
}

/** Manages one IDN IRC-over-WebSocket connection per live session slug. */
export class IdnChatManager {
  private active = new Map<string, IdnChatConnection>();
  private graceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private onLine: (line: string, member: LiveMember, channel: string) => void,
    private lifecycle: ChatLifecycle = NOOP_LIFECYCLE,
  ) {}

  sync(liveMembers: LiveMember[]) {
    const liveBySlug = new Map(liveMembers.map((member) => [member.slug, member]));
    for (const member of liveMembers) {
      const timer = this.graceTimers.get(member.slug);
      if (timer) {
        clearTimeout(timer);
        this.graceTimers.delete(member.slug);
      }
      if (!this.active.has(member.slug)) {
        const connection = new IdnChatConnection(member, this.onLine, this.lifecycle);
        this.active.set(member.slug, connection);
        connection.start();
        console.log(`[idnchat] watching ${member.username} (${member.slug})`);
      }
    }
    for (const slug of this.active.keys()) {
      if (!liveBySlug.has(slug) && !this.graceTimers.has(slug)) {
        const timer = setTimeout(() => {
          this.active.get(slug)?.stop();
          this.active.delete(slug);
          this.graceTimers.delete(slug);
          console.log(`[idnchat] stopped watching ${slug} (live ended)`);
        }, GRACE_MS);
        this.graceTimers.set(slug, timer);
      }
    }
  }
}
