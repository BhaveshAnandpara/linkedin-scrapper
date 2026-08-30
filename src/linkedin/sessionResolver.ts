// Multi-tier session resolution for a single /api/profile request:
// a bearer token's own session > the shared Redis-stored default > the
// original env-var session. Purely additive on top of Phase 1 — if Redis
// is unreachable or nothing was ever stored there, this degrades exactly
// to Phase 1's env-var-only behavior via the unchanged getSession().

import { getSession, buildSession, type Session } from "./session.js";
import {
  getVisitorSession,
  getDefaultSession,
  resolveSessionSource,
} from "../sessions/sessionStore.js";

export type ResolveSessionError = "SESSION_EXPIRED" | "SESSION_NOT_CONFIGURED";

export type ResolveSessionResult =
  | { ok: true; session: Session }
  | { ok: false; error: ResolveSessionError };

export async function resolveRequestSession(
  bearerToken: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolveSessionResult> {
  if (bearerToken) {
    const stored = await getVisitorSession(bearerToken);
    // An unrecognized/invalid token never falls through to the shared
    // default — that would let a bad token silently borrow someone else's
    // session in a confusing way. It's its own distinct failure.
    if (!stored) {
      return { ok: false, error: "SESSION_EXPIRED" };
    }
    return {
      ok: true,
      session: buildSession(stored.liAt, stored.jsessionid, stored.userAgent),
    };
  }

  const defaultStored = await getDefaultSession();
  const envResult = getSession(env);

  const source = resolveSessionSource({
    hasToken: false,
    hasStoredDefault: !!defaultStored,
    hasEnvFallback: envResult.ok,
  });

  if (source === "default" && defaultStored) {
    return {
      ok: true,
      session: buildSession(defaultStored.liAt, defaultStored.jsessionid, defaultStored.userAgent),
    };
  }
  if (source === "envFallback") {
    return envResult;
  }
  return { ok: false, error: "SESSION_NOT_CONFIGURED" };
}
