// Reads the manually-captured LinkedIn session from environment variables.
// Phase 1 design: no login flow runs at request time — the session comes
// from a human logging into LinkedIn once, outside the deployed system.

export interface Session {
  cookieHeader: string;
  csrfToken: string;
  userAgent: string;
}

export type SessionResult =
  | { ok: true; session: Session }
  | { ok: false; error: "SESSION_NOT_CONFIGURED" };

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

/**
 * A minimal `li_at` + `JSESSIONID` cookie pair is sometimes enough, but real
 * testing during recon showed LinkedIn can soft-challenge (redirect loop)
 * requests that look too thin compared to a real browser's cookie jar.
 * LI_EXTRA_COOKIES is an optional escape hatch: paste the rest of a real
 * browser's cookie header here (e.g. bcookie, bscookie, lidc, ...) if the
 * minimal pair starts getting challenged.
 */
/**
 * Pure: assembles a Session from already-known raw values, regardless of
 * where they came from (env vars here, Redis-stored sessions in
 * sessionResolver.ts). Extracted so both sources share the exact same
 * cookie-header-assembly logic instead of duplicating it.
 */
export function buildSession(
  liAt: string,
  jsessionRaw: string,
  userAgent?: string,
  extraCookies?: string,
): Session {
  const csrfToken = jsessionRaw.replace(/^"|"$/g, "");
  const extra = extraCookies ? `; ${extraCookies}` : "";
  const cookieHeader = `li_at=${liAt}; JSESSIONID="${csrfToken}"${extra}`;
  return { cookieHeader, csrfToken, userAgent: userAgent || DEFAULT_USER_AGENT };
}

export function getSession(env: NodeJS.ProcessEnv = process.env): SessionResult {
  const liAt = env.LI_AT_COOKIE;
  const jsessionRaw = env.LI_JSESSIONID;
  if (!liAt || !jsessionRaw) {
    return { ok: false, error: "SESSION_NOT_CONFIGURED" };
  }

  return {
    ok: true,
    session: buildSession(liAt, jsessionRaw, env.LI_USER_AGENT, env.LI_EXTRA_COOKIES),
  };
}
