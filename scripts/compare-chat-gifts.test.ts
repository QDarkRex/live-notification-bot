import { describe, expect, it } from "vitest";
// @ts-expect-error CommonJS helper intentionally stays directly runnable by Node.
import { compareRows, matchHistory } from "./compare-chat-gifts.cjs";

const history = [
  {
    slug: "show-20261104",
    username: "jkt48_mikaela",
    member: "Mikaela",
    live_at: "2026-11-04T17:29:36+07:00",
    ended_at: 1793792379874,
    total_gifters: 2,
    total_gold: 120,
  },
];

const session = {
  slug: "jkt48_mikaela-show-20261104",
  username: "jkt48_mikaela",
  first_attached_at: "2026-11-04T17:30:00+07:00",
  connect_count: 2,
  disconnect_count: 1,
  gold: 100,
  gifters: 1,
};

describe("chat gift comparison", () => {
  it("matches exact slug and username", () => {
    expect(matchHistory({ ...session, slug: history[0].slug }, history)).toBe(history[0]);
  });

  it("matches a unique suffixed slug only with the same username", () => {
    expect(matchHistory(session, history)).toBe(history[0]);
    expect(matchHistory({ ...session, username: "other" }, history)).toBeNull();
  });

  it("refuses ambiguous suffix candidates", () => {
    const duplicated = [{ ...history[0] }, { ...history[0], slug: "20261104" }];
    expect(matchHistory(session, duplicated)).toBeNull();
  });

  it("reports observed differences and possible gaps", () => {
    const [row] = compareRows([session], history);
    expect(row).toMatchObject({
      status: "difference_observed",
      delta_gold: -20,
      delta_gifters: -1,
      live_at: history[0].live_at,
      flags: ["joined_after_start", "connection_gaps_possible"],
    });
  });

  it("reports equal totals as observed while retaining late-join and gap flags", () => {
    const [row] = compareRows([{ ...session, slug: history[0].slug, gold: 120, gifters: 2 }], history);
    expect(row).toMatchObject({
      status: "match_observed",
      delta_gold: 0,
      delta_gifters: 0,
      flags: ["joined_after_start", "connection_gaps_possible"],
    });
    expect(row.status).not.toBe("verified_complete");
  });

  it("keeps a null attachment timestamp unset without flagging a late join", () => {
    const [row] = compareRows(
      [{ ...session, first_attached_at: null, connect_count: 1, disconnect_count: 0 }],
      history,
    );
    expect(row.first_attached_at).toBeNull();
    expect(row.flags).toEqual([]);
  });

  it("retains sessions without a history match as pending", () => {
    expect(compareRows([{ ...session, username: "other" }], history)[0].status).toBe("pending");
  });
});
