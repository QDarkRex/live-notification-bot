import type { Request } from "express";
import { rateLimit } from "express-rate-limit";

import { env } from "@/common/utils/envConfig";

// The bot's own notifiers call this API over localhost: /schedule every 60s,
// /schedule/section every 30s, /news on its timer. That alone is ~90 requests
// per 15 min against a limit of 20, so they were rate-limiting themselves (429)
// as soon as jkt48.com data answered quickly again (2026-10-30). Only outside
// callers are limited.
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export const isLoopback = (req: Request) => LOOPBACK.has(req.ip ?? "");

const rateLimiter = rateLimit({
  legacyHeaders: true,
  limit: env.COMMON_RATE_LIMIT_MAX_REQUESTS,
  message: "Too many requests, please try again later.",
  standardHeaders: true,
  windowMs: 15 * 60 * env.COMMON_RATE_LIMIT_WINDOW_MS,
  keyGenerator: (req: Request) => req.ip as string,
  skip: isLoopback,
});

export default rateLimiter;
