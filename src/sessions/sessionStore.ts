// Redis-backed store for LinkedIn sessions: visitor sessions keyed by an
// opaque bearer token, plus one reserved "default" key for the shared
// session that previously lived only in env vars. Reuses the same Upstash
// instance already provisioned for rate limiting (src/cache/redisClient.ts).

import { randomUUID } from "node:crypto";
import { getRedisClient } from "../cache/redisClient.js";

export interface StoredSession {
  liAt: string;
  jsessionid: string;
  userAgent?: string;
  capturedAt: string;
}

// Shared shape/validation for the request body both session endpoints
// (POST /api/sessions and POST /api/sessions/default) accept — previously
// duplicated verbatim in each handler.
export type SessionSubmission = Omit<StoredSession, "capturedAt">;

export function parseSessionSubmission(body: unknown): SessionSubmission | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const { liAt, jsessionid, userAgent } = body as Record<string, unknown>;
  if (
    typeof liAt !== "string" ||
    !liAt.trim() ||
    typeof jsessionid !== "string" ||
    !jsessionid.trim()
  ) {
    return null;
  }
  if (userAgent !== undefined && typeof userAgent !== "string") {
    return null;
  }
  return { liAt, jsessionid, userAgent };
}

// Visitor tokens: long enough to cover a review window, short enough that
// Redis doesn't accumulate stale entries forever.
const VISITOR_TTL_SECONDS = 7 * 24 * 60 * 60;
// The default session: no meaningful freshness signal here (the owner keeps
// refreshing it directly) — this TTL is storage hygiene, not a staleness
// check. Actual staleness is always detected via LinkedIn's own 401/403/302,
// mapped to SESSION_EXPIRED.
const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60;

const TOKEN_KEY_PREFIX = "session:token:";
const DEFAULT_KEY = "session:default";

export function generateToken(): string {
  return randomUUID();
}

export type SessionSource = "token" | "default" | "envFallback" | "none";

/**
 * The one pure, TDD'd decision this feature introduces: given which sources
 * are available, which one should a request use? A token being present
 * always wins over the shared default; a shared default wins over the
 * original env-var fallback. Note: this only decides priority among
 * *available* sources — an unrecognized/invalid token is handled by the
 * caller as its own early-return failure (SESSION_EXPIRED), not as
 * "hasToken: false" here, since a bad token should never silently fall
 * through to someone else's session.
 */
export function resolveSessionSource(input: {
  hasToken: boolean;
  hasStoredDefault: boolean;
  hasEnvFallback: boolean;
}): SessionSource {
  if (input.hasToken) {
    return "token";
  }
  if (input.hasStoredDefault) {
    return "default";
  }
  if (input.hasEnvFallback) {
    return "envFallback";
  }
  return "none";
}

export async function storeVisitorSession(
  session: Omit<StoredSession, "capturedAt">,
): Promise<{ token: string } | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }

  const token = generateToken();
  const stored: StoredSession = { ...session, capturedAt: new Date().toISOString() };
  await redis.set(`${TOKEN_KEY_PREFIX}${token}`, stored, { ex: VISITOR_TTL_SECONDS });
  return { token };
}

export async function getVisitorSession(token: string): Promise<StoredSession | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }
  return redis.get<StoredSession>(`${TOKEN_KEY_PREFIX}${token}`);
}

export async function storeDefaultSession(
  session: Omit<StoredSession, "capturedAt">,
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) {
    return false;
  }

  const stored: StoredSession = { ...session, capturedAt: new Date().toISOString() };
  await redis.set(DEFAULT_KEY, stored, { ex: DEFAULT_TTL_SECONDS });
  return true;
}

export async function getDefaultSession(): Promise<StoredSession | null> {
  const redis = getRedisClient();
  if (!redis) {
    return null;
  }
  return redis.get<StoredSession>(DEFAULT_KEY);
}
