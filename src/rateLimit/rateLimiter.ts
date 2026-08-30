// @upstash/ratelimit sliding window keyed by client IP, checked before any
// LinkedIn call. If Upstash isn't configured (e.g. running locally without
// it set up), this fails open — the request proceeds unlimited rather than
// the whole API going down — since Redis is essential for protecting the
// LinkedIn account in production but shouldn't block local dev/testing.

import { Ratelimit } from "@upstash/ratelimit";
import { getRedisClient } from "../cache/redisClient.js";

export type RateLimitCheck =
  | { ok: true; limited: false; remaining: number }
  | { ok: true; limited: true; remaining: number; resetAt: number }
  | { ok: false; error: "RATE_LIMIT_NOT_CONFIGURED" };

let ratelimit: Ratelimit | null | undefined;

function getRatelimit(): Ratelimit | null {
  if (ratelimit !== undefined) {
    return ratelimit;
  }

  const redis = getRedisClient();
  if (!redis) {
    ratelimit = null;
    return ratelimit;
  }

  const maxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 10);
  const windowSeconds = Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60);

  ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(maxRequests, `${windowSeconds} s`),
    prefix: "linkedin-profile-api",
  });
  return ratelimit;
}

export async function checkRateLimit(identifier: string): Promise<RateLimitCheck> {
  const limiter = getRatelimit();
  if (!limiter) {
    return { ok: false, error: "RATE_LIMIT_NOT_CONFIGURED" };
  }

  const result = await limiter.limit(identifier);
  return result.success
    ? { ok: true, limited: false, remaining: result.remaining }
    : { ok: true, limited: true, remaining: result.remaining, resetAt: result.reset };
}
