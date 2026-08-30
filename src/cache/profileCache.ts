// Short-TTL cache of parsed ProfileResponse objects, keyed by resolved
// publicIdentifier. Sits in front of the LinkedIn fetch step so repeat or
// concurrent requests for the same profile don't each spend a fresh call
// against the shared, rate-limited, ban-able LinkedIn session. Reuses the
// same Redis instance already provisioned for rate limiting and sessions;
// a miss or an unreachable Redis both degrade to a live fetch, exactly like
// today's uncached behavior — this cache is strictly additive.

import { getRedisClient } from "./redisClient.js";
import type { ProfileResponse } from "../types/profile.js";

const CACHE_KEY_PREFIX = "profile-cache:";
const DEFAULT_TTL_SECONDS = 600;

function ttlSeconds(): number {
  return Number(process.env.PROFILE_CACHE_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
}

export async function getCachedProfile(
  publicIdentifier: string,
): Promise<ProfileResponse | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }
  return redis.get<ProfileResponse>(`${CACHE_KEY_PREFIX}${publicIdentifier}`);
}

export async function setCachedProfile(
  publicIdentifier: string,
  profile: ProfileResponse,
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }
  await redis.set(`${CACHE_KEY_PREFIX}${publicIdentifier}`, profile, { ex: ttlSeconds() });
}

// Used by a "follower" request that lost the per-identifier fetch lock
// (see callConcurrency.ts): polls for the lock holder's result to land in
// the cache instead of independently calling LinkedIn for the same profile.
// The clock/sleep are injectable so tests can run this deterministically
// without real delays.
export async function waitForCachedProfile(
  publicIdentifier: string,
  maxWaitMs: number,
  pollIntervalMs = 250,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<ProfileResponse | null> {
  const deadline = now() + maxWaitMs;
  while (now() < deadline) {
    const cached = await getCachedProfile(publicIdentifier);
    if (cached) {
      return cached;
    }
    await sleep(pollIntervalMs);
  }
  return null;
}
