// Shared @upstash/redis client instance, built from env vars. Returns null
// (rather than throwing) when Upstash isn't configured, so callers — the
// rate limiter now, the optional profile cache later — can each decide how
// to degrade instead of crashing the whole request pipeline.

import { Redis } from "@upstash/redis";

let client: Redis | null | undefined;

export function getRedisClient(): Redis | null {
  if (client !== undefined) {
    return client;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    client = null;
    return client;
  }

  client = new Redis({ url, token });
  return client;
}
