import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { isLoopback } from "../middleware/rateLimiter";

const req = (ip: string | undefined) => ({ ip }) as Request;

describe("rateLimiter skip", () => {
  it("never limits the bot's own notifiers calling over localhost", () => {
    expect(isLoopback(req("::1"))).toBe(true);
    expect(isLoopback(req("127.0.0.1"))).toBe(true);
    expect(isLoopback(req("::ffff:127.0.0.1"))).toBe(true);
  });

  it("still limits everyone else", () => {
    expect(isLoopback(req("172.18.0.5"))).toBe(false);
    expect(isLoopback(req("100.94.86.22"))).toBe(false);
    expect(isLoopback(req(undefined))).toBe(false);
  });
});
