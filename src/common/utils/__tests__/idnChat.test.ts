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
