import { describe, expect, it } from "vitest";
import { takeLines } from "../ircLines";

describe("takeLines", () => {
  it("treats a newline-less frame as one complete line (current IDN server)", () => {
    expect(takeLines("", "PING :abc")).toEqual({ lines: ["PING :abc"], rest: "" });
    expect(takeLines("", ":irc-3.idn.app CAP * LS :account-notify")).toEqual({
      lines: [":irc-3.idn.app CAP * LS :account-notify"],
      rest: "",
    });
  });

  it("splits a CRLF stream and keeps a trailing partial line", () => {
    expect(takeLines("", 'PING :a\r\n:x 001 me :hi\r\n@time=1 :x PRIVMSG #r :{"gi')).toEqual({
      lines: ["PING :a", ":x 001 me :hi"],
      rest: '@time=1 :x PRIVMSG #r :{"gi',
    });
  });

  it("joins a line split across frames", () => {
    const first = takeLines("", 'PING :a\r\n:x PRIVMSG #r :{"gift":');
    const second = takeLines(first.rest, '{"gold":11}}\r\n');
    expect(second).toEqual({ lines: [':x PRIVMSG #r :{"gift":{"gold":11}}'], rest: "" });
  });

  it("keeps appending a newline-less middle piece while a line is buffered", () => {
    const a = takeLines("", "PING :a\r\n:x PRIVMSG #r :part1-");
    const b = takeLines(a.rest, "part2-");
    expect(b).toEqual({ lines: [], rest: ":x PRIVMSG #r :part1-part2-" });
    expect(takeLines(b.rest, "part3\r\n").lines).toEqual([":x PRIVMSG #r :part1-part2-part3"]);
  });

  it("drops empty frames", () => {
    expect(takeLines("", "")).toEqual({ lines: [], rest: "" });
    expect(takeLines("", "\r\n")).toEqual({ lines: [], rest: "" });
  });
});
