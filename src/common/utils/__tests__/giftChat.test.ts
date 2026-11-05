import { afterEach, describe, expect, it, vi } from "vitest";
import { parseChatGift } from "../giftChat";
import type { LiveMember } from "../idnChat";

const member: LiveMember = {
  uuid: "streamer-uuid",
  username: "jkt48_example",
  name: "Example",
  slug: "live-261104182414",
};
const channel = "arn:aws:ivschat:us-east-1:050891932989:room/example";

function line({
  sender = "IDNOdin!IDNOdin@serverop.idn.app",
  room = channel,
  slug = member.slug,
  msgid = "201~1792744405~5091084",
  time = "2026-11-04T12:11:03.331Z",
  user = { name: "Rahman Tea", uuid: "gifter-uuid" },
  gift = { name: "Outt!", slug: "outt-1714103966", gold: 11, point: 44, weight: 1 },
}: Record<string, any> = {}) {
  return `@time=${time};msgid=${msgid} :${sender} PRIVMSG #${room} :${JSON.stringify({ user, gift, room_id: slug })}`;
}

afterEach(() => vi.restoreAllMocks());

describe("parseChatGift", () => {
  it("accepts the observed IDNOdin broadcast and uses event time and gold/point once", () => {
    const event = parseChatGift(line(), member, channel, Date.parse("2026-11-04T17:30:00Z"));
    expect(event).toMatchObject({
      streamer_uuid: member.uuid,
      slug: member.slug,
      msgid: "201~1792744405~5091084",
      event_at: Date.parse("2026-11-04T12:11:03.331Z"),
      received_at: Date.parse("2026-11-04T17:30:00Z"),
      day: "2026-11-04",
      gifter_uuid: "gifter-uuid",
      gifter_name: "Rahman Tea",
      gold: 11,
      point: 44,
    });
  });

  it("uses the observed gift values directly without multiplying by its weight", () => {
    // Live Gracie capture (2026-11-04): this gifter's poll/chat totals were 619 Gold from 599 + 20.
    const observedMember = { ...member, slug: "hiii-261104202455" };
    const event = parseChatGift(
      line({
        slug: observedMember.slug,
        msgid: "gracie-observed-gift",
        gift: { name: "MELUNCUR!!", slug: "meluncur-1762769857", gold: 599, point: 2396, weight: 10 },
      }),
      observedMember,
      channel,
    );
    expect(event).toMatchObject({ gold: 599, point: 2396 });
  });

  it("preserves distinct messages from the same user and ignores non-gifts", () => {
    expect(parseChatGift(line(), member, channel)?.msgid).toBe("201~1792744405~5091084");
    expect(parseChatGift(line({ msgid: "another-event-id" }), member, channel)?.msgid).toBe("another-event-id");
    const comment = `@time=2026-11-04T12:11:03.331Z;msgid=x :IDNLoki!IDNLoki@serverop.idn.app PRIVMSG #${channel} :{"chat":{"text":"hello"}}`;
    expect(parseChatGift(comment, member, channel)).toBeNull();
  });

  it("keeps a valid gift with a blank display name and falls back to the gifter UUID", () => {
    const event = parseChatGift(line({ user: { name: " ", uuid: "gifter-uuid" } }), member, channel);
    expect(event?.gifter_name).toBe("gifter-uuid");
  });

  it.each([
    ["wrong sender", { sender: "IDNLoki!IDNLoki@serverop.idn.app" }],
    ["wrong channel", { room: "another-room" }],
    ["wrong slug", { slug: "another-live" }],
    ["missing msgid", { msgid: "" }],
    ["invalid time", { time: "not-a-time" }],
    ["missing user", { user: { name: "", uuid: "" } }],
    ["negative gold", { gift: { gold: -1, point: 1 } }],
    ["unsafe point", { gift: { gold: 1, point: Number.MAX_SAFE_INTEGER + 1 } }],
    ["zero value", { gift: { gold: 0, point: 0 } }],
  ])("rejects %s and logs the invalid gift", (_label, overrides) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseChatGift(line(overrides), member, channel)).toBeNull();
    expect(warning).toHaveBeenCalledOnce();
  });

  it("warns for an untagged IDNOdin gift instead of fabricating an event id", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const untagged = line().replace(/^@[^ ]+ /, "");
    expect(parseChatGift(untagged, member, channel)).toBeNull();
    expect(warning).toHaveBeenCalledWith("[gift-chat] ignored invalid gift event: missing msgid");
  });
});
