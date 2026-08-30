// Distributed guardrails around outbound calls to LinkedIn's Voyager API:
//
// 1. A global cap on how many calls the shared session may have in flight
//    at once, independent of which profile is being fetched — protects
//    against many different profiles (or many different callers) all
//    hitting LinkedIn concurrently under the same account.
// 2. A per-identifier lock so concurrent requests for the *same* profile
//    don't each independently call LinkedIn — only the lock holder fetches;
//    everyone else waits for its result via the profile cache (see
//    waitForCachedProfile in profileCache.ts).
//
// State lives in Redis (the same instance already used for rate limiting
// and sessions) since Vercel functions don't share in-process memory across
// concurrent invocations. If Redis is unconfigured, both primitives degrade
// to "proceed uncoordinated" — the rate limiter already fails closed on a
// missing Redis config in production (see rateLimiter.ts's
// shouldFailClosed), so by the time this code runs in production, Redis is
// already known to be configured; this fallback only fires in local/preview
// environments where no coordination is expected anyway.

import { getRedisClient } from "../cache/redisClient.js";

const INFLIGHT_KEY = "linkedin-calls:inflight";
const INFLIGHT_LEASE_TTL_MS = 30_000;
const LOCK_KEY_PREFIX = "linkedin-lock:";
const LOCK_TTL_SECONDS = 30;

function maxConcurrentCalls(): number {
  return Number(process.env.LINKEDIN_MAX_CONCURRENT_CALLS ?? 5);
}

export type SlotAcquireResult = { ok: true; leaseId: string } | { ok: false };

export async function acquireCallSlot(now: number = Date.now()): Promise<SlotAcquireResult> {
  const redis = getRedisClient();
  if (!redis) {
    return { ok: true, leaseId: "" };
  }

  await redis.zremrangebyscore(INFLIGHT_KEY, 0, now);
  const count = await redis.zcard(INFLIGHT_KEY);
  if (count >= maxConcurrentCalls()) {
    return { ok: false };
  }

  const leaseId = `${now}-${Math.random().toString(36).slice(2)}`;
  await redis.zadd(INFLIGHT_KEY, { score: now + INFLIGHT_LEASE_TTL_MS, member: leaseId });
  return { ok: true, leaseId };
}

export async function releaseCallSlot(leaseId: string): Promise<void> {
  if (!leaseId) {
    return;
  }
  const redis = getRedisClient();
  if (!redis) {
    return;
  }
  await redis.zrem(INFLIGHT_KEY, leaseId);
}

export async function acquireIdentifierLock(
  publicIdentifier: string,
  leaseId: string,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    return true;
  }
  const result = await redis.set(`${LOCK_KEY_PREFIX}${publicIdentifier}`, leaseId, {
    nx: true,
    ex: LOCK_TTL_SECONDS,
  });
  return result === "OK";
}

// Compare-and-delete: only removes the lock if it still holds *this* lease.
// Without the compare, a slow leader whose lease already expired could
// delete a different, later caller's lock after it acquired the same key.
export async function releaseIdentifierLock(
  publicIdentifier: string,
  leaseId: string,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }
  const key = `${LOCK_KEY_PREFIX}${publicIdentifier}`;
  const current = await redis.get<string>(key);
  if (current === leaseId) {
    await redis.del(key);
  }
}
