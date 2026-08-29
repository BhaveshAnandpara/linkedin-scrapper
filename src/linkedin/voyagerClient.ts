// Low-level HTTP client for LinkedIn's Voyager API: builds headers/cookies
// from a Session, calls fetch(), classifies the response into a typed
// result or transport error. Knows nothing about the ProfileResponse shape.

import type { Session } from "./session.js";

export interface VoyagerSuccess {
  ok: true;
  data: unknown;
}

export type VoyagerErrorCode =
  | "SESSION_EXPIRED"
  | "NOT_FOUND"
  | "LINKEDIN_RATE_LIMITED"
  | "UPSTREAM_ERROR";

export interface VoyagerFailure {
  ok: false;
  error: VoyagerErrorCode;
  status?: number;
}

export type VoyagerResult = VoyagerSuccess | VoyagerFailure;

function buildHeaders(session: Session, referer: string): Record<string, string> {
  return {
    cookie: session.cookieHeader,
    "csrf-token": session.csrfToken,
    "x-restli-protocol-version": "2.0.0",
    "x-li-lang": "en_US",
    accept: "application/json",
    "user-agent": session.userAgent,
    referer,
  };
}

/**
 * Calls a LinkedIn Voyager API URL with the given session.
 *
 * Response classification (see reference/endpoint-notes.md for how these
 * were confirmed during recon):
 *  - 200            -> parsed JSON body
 *  - 401 / 403 / 302 -> SESSION_EXPIRED (LinkedIn soft-challenges/redirect-
 *    loops rather than issuing a clean 401 in practice; Phase 1 does not
 *    auto-retry via login, so this always surfaces as a fresh-capture-needed
 *    error)
 *  - 404            -> NOT_FOUND
 *  - 429            -> LINKEDIN_RATE_LIMITED
 *  - anything else / network failure -> UPSTREAM_ERROR
 */
export async function voyagerGet(
  url: string,
  session: Session,
  referer: string,
): Promise<VoyagerResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: buildHeaders(session, referer),
      redirect: "manual",
    });
  } catch {
    return { ok: false, error: "UPSTREAM_ERROR" };
  }

  if (response.status === 200) {
    try {
      const data: unknown = await response.json();
      return { ok: true, data };
    } catch {
      return { ok: false, error: "UPSTREAM_ERROR", status: response.status };
    }
  }

  if (response.status === 401 || response.status === 403 || response.status === 302) {
    return { ok: false, error: "SESSION_EXPIRED", status: response.status };
  }
  if (response.status === 404) {
    return { ok: false, error: "NOT_FOUND", status: response.status };
  }
  if (response.status === 429) {
    return { ok: false, error: "LINKEDIN_RATE_LIMITED", status: response.status };
  }
  return { ok: false, error: "UPSTREAM_ERROR", status: response.status };
}
