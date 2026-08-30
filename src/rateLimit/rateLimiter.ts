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

// Keyed cache so the profile and session endpoints can each hold their own
// Ratelimit instance (different limits, different Redis key prefix) without
// each call site reaching into Redis config directly.
const limiters = new Map<string, Ratelimit | null>();

function getRatelimitFor(
  cacheKey: string,
  prefix: string,
  maxRequests: number,
  windowSeconds: number,
): Ratelimit | null {
  const cached = limiters.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const redis = getRedisClient();
  if (!redis) {
    limiters.set(cacheKey, null);
    return null;
  }

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(maxRequests, `${windowSeconds} s`),
    prefix,
  });
  limiters.set(cacheKey, limiter);
  return limiter;
}

async function runCheck(limiter: Ratelimit | null, identifier: string): Promise<RateLimitCheck> {
  if (!limiter) {
    return { ok: false, error: "RATE_LIMIT_NOT_CONFIGURED" };
  }

  const result = await limiter.limit(identifier);
  return result.success
    ? { ok: true, limited: false, remaining: result.remaining }
    : { ok: true, limited: true, remaining: result.remaining, resetAt: result.reset };
}

// If Redis is unconfigured in production, checkRateLimit's fail-open default
// would silently remove the only throttle protecting the shared LinkedIn
// account. Call sites should refuse the request instead in that case; local/
// preview environments keep the fail-open behavior above unchanged.
export function shouldFailClosed(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}

export async function checkRateLimit(identifier: string): Promise<RateLimitCheck> {
  const maxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 10);
  const windowSeconds = Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60);
  const limiter = getRatelimitFor("profile", "linkedin-profile-api", maxRequests, windowSeconds);
  return runCheck(limiter, identifier);
}

// Stricter, separate limiter for the session-submission endpoints (bring-
// your-own-session and admin default-session-refresh). Legitimate callers
// hit these rarely, so the default allowance is much lower than the
// read-heavy profile endpoint's — this exists to throttle cheap abuse
// (flooding session storage, guessing the admin secret), not real traffic.
export async function checkSessionRateLimit(identifier: string): Promise<RateLimitCheck> {
  const maxRequests = Number(process.env.SESSION_RATE_LIMIT_MAX_REQUESTS ?? 5);
  const windowSeconds = Number(process.env.SESSION_RATE_LIMIT_WINDOW_SECONDS ?? 60);
  const limiter = getRatelimitFor(
    "sessions",
    "linkedin-profile-api-sessions",
    maxRequests,
    windowSeconds,
  );
  return runCheck(limiter, identifier);
}
