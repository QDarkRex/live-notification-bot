import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sockets: [] as any[],
  axiosGet: vi.fn(),
}));

vi.mock("axios", () => ({ default: { get: mocks.axiosGet } }));
vi.mock("ws", () => {
  class MockWebSocket {
    static OPEN = 1;
    readyState = 0;
    handlers = new Map<string, ((...args: any[]) => void)[]>();
    sent: string[] = [];
    constructor() {
      mocks.sockets.push(this);
    }
    on(event: string, handler: (...args: any[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    emit(event: string, ...args: any[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      this.readyState = 3;
      this.emit("close", 1000, "closed");
    }
  }
  return { default: MockWebSocket };
});

import { parseChatGift } from "../giftChat";
import { IdnChatManager, type LiveMember } from "../idnChat";

const member: LiveMember = { uuid: "streamer", username: "jkt48_example", name: "Example", slug: "session" };
const channel = "arn:aws:ivschat:us-east-1:050891932989:room/example";

function giftLine() {
  return `@time=2026-11-04T12:11:03.331Z;msgid=event-1 :IDNOdin!IDNOdin@serverop.idn.app PRIVMSG #${channel} :${JSON.stringify(
    {
      user: { name: "Gifter", uuid: "gifter" },
      gift: { gold: 11, point: 44 },
      room_id: member.slug,
    },
  )}`;
}

async function startManager(manager: IdnChatManager) {
  manager.sync([member]);
  await vi.waitFor(() => expect(mocks.sockets).toHaveLength(1));
  const ws = mocks.sockets[0];
  ws.readyState = 1;
  ws.emit("open");
  ws.emit("message", ":irc 001 idn :welcome");
  return ws;
}

afterEach(() => {
  mocks.sockets = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("IDN shared chat transport", () => {
  it.each([
    ["bare PING", "PING :irc-1.idn.app", "PONG :irc-1.idn.app"],
    ["tagged PING", "@time=2026-11-05T01:40:16.360Z PING :irc-1.idn.app", "PONG :irc-1.idn.app"],
    [
      "tagged prefixed PING",
      "@time=2026-11-05T01:40:16.360Z :irc-1.idn.app PING :irc-1.idn.app",
      "PONG :irc-1.idn.app",
    ],
  ])("answers %s on the same socket and keeps it out of line dispatch", async (_label, ping, pong) => {
    mocks.axiosGet.mockResolvedValue({
      data: '<script id="__NEXT_DATA__">{"props":{"pageProps":{"livestream":{"chat_room_id":"room"}}}}</script>',
    });
    const received: string[] = [];
    const manager = new IdnChatManager((line) => received.push(line));
    const ws = await startManager(manager);

    ws.emit("message", ping);

    expect(ws.sent).toContain(`${pong}\r\n`);
    expect(received).toEqual([]);
  });

  it("passes through gift payloads containing PING without treating them as controls", async () => {
    mocks.axiosGet.mockResolvedValue({
      data: '<script id="__NEXT_DATA__">{"props":{"pageProps":{"livestream":{"chat_room_id":"arn:aws:ivschat:us-east-1:050891932989:room/example"}}}}</script>',
    });
    const received: string[] = [];
    const manager = new IdnChatManager((line) => received.push(line));
    const ws = await startManager(manager);
    const line = giftLine().replace('"name":"Gifter"', '"name":"PING"');

    ws.emit("message", line);

    expect(received).toEqual([line]);
    expect(ws.sent.some((sent: string) => sent.startsWith("PONG"))).toBe(false);
  });

  it("dispatches the gift line from its attached session socket", async () => {
    mocks.axiosGet.mockResolvedValue({
      data: '<script id="__NEXT_DATA__">{"props":{"pageProps":{"livestream":{"chat_room_id":"arn:aws:ivschat:us-east-1:050891932989:room/example"}}}}</script>',
    });
    const gifts: unknown[] = [];
    const lifecycle = { onOpen: vi.fn(), onAttached: vi.fn(), onUnexpectedDisconnect: vi.fn() };
    const manager = new IdnChatManager((line, liveMember, room) => {
      const gift = parseChatGift(line, liveMember, room);
      if (gift) gifts.push(gift);
    }, lifecycle);
    const ws = await startManager(manager);
    ws.emit("message", giftLine());
    expect(gifts).toHaveLength(1);
    expect(ws.sent).toContain(`JOIN #${channel}\r\n`);
    expect(lifecycle.onOpen).toHaveBeenCalledOnce();
    expect(lifecycle.onAttached).toHaveBeenCalledOnce();
  });

  it("passes a gift whose JSON contains ' 001 ' and ' CAP x LS ' through unchanged", async () => {
    mocks.axiosGet.mockResolvedValue({
      data: '<script id="__NEXT_DATA__">{"props":{"pageProps":{"livestream":{"chat_room_id":"arn:aws:ivschat:us-east-1:050891932989:room/example"}}}}</script>',
    });
    const received: string[] = [];
    const manager = new IdnChatManager((line) => received.push(line));
    const ws = await startManager(manager);
    const joinsBefore = ws.sent.filter((sent: string) => sent.startsWith("JOIN")).length;
    const capsBefore = ws.sent.filter((sent: string) => sent.startsWith("CAP REQ")).length;
    const line = giftLine().replace('"name":"Gifter"', '"name":"agent 001 x CAP x LS y"');

    ws.emit("message", line);

    expect(received).toEqual([line]);
    expect(ws.sent.filter((sent: string) => sent.startsWith("JOIN")).length).toBe(joinsBefore);
    expect(ws.sent.filter((sent: string) => sent.startsWith("CAP REQ")).length).toBe(capsBefore);
  });

  it("still handles real server 001 and CAP LS lines (plain and tagged)", async () => {
    mocks.axiosGet.mockResolvedValue({
      data: '<script id="__NEXT_DATA__">{"props":{"pageProps":{"livestream":{"chat_room_id":"room"}}}}</script>',
    });
    const received: string[] = [];
    const manager = new IdnChatManager((line) => received.push(line));
    manager.sync([member]);
    await vi.waitFor(() => expect(mocks.sockets).toHaveLength(1));
    const ws = mocks.sockets[0];
    ws.readyState = 1;
    ws.emit("open");
    ws.emit("message", ":irc.idn.app CAP * LS :server-time message-tags");
    expect(ws.sent.some((sent: string) => sent.startsWith("CAP REQ"))).toBe(true);
    expect(ws.sent).toContain("CAP END\r\n");
    ws.emit("message", "@time=2026-11-05T01:00:00.000Z :irc.idn.app 001 idn-x :Welcome");
    expect(ws.sent).toContain("JOIN #room\r\n");
    expect(received).toEqual([]);
  });

  it("retains healthy fast reconnect and throttled slow reconnect behavior", async () => {
    mocks.axiosGet.mockResolvedValue({
      data: '<script id="__NEXT_DATA__">{"props":{"pageProps":{"livestream":{"chat_room_id":"room"}}}}</script>',
    });
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const manager = new IdnChatManager(() => {});
    manager.sync([member]);
    await vi.waitFor(() => expect(mocks.sockets).toHaveLength(1));
    const healthy = mocks.sockets[0];
    healthy.readyState = 1;
    healthy.emit("open");
    healthy.emit("message", "PING :healthy");
    healthy.readyState = 3;
    healthy.emit("close", 1006, "cut");
    await vi.advanceTimersByTimeAsync(1_500);
    expect(mocks.sockets).toHaveLength(2);

    const throttledManager = new IdnChatManager(() => {});
    throttledManager.sync([{ ...member, slug: "throttled-session" }]);
    await vi.waitFor(() => expect(mocks.sockets).toHaveLength(3));
    const throttled = mocks.sockets[2];
    throttled.readyState = 1;
    throttled.emit("open");
    throttled.readyState = 3;
    throttled.emit("close", 1006, "no data");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(mocks.sockets).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.sockets).toHaveLength(4);
  });
});
