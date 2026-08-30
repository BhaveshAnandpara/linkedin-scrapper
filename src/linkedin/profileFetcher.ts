// (profileUrl, session) -> raw Voyager JSON | typed fetch error.
// Composes identifiers.ts (URL -> publicIdentifier) and voyagerClient.ts
// (the actual HTTP call). Contains no knowledge of the ProfileResponse
// schema — that's profileParser.ts's job.

import { parseProfileUrl } from "./identifiers.js";
import { voyagerGet, type VoyagerErrorCode } from "./voyagerClient.js";
import type { Session } from "./session.js";

const DECORATION_ID =
  "com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93";

export type ProfileFetchError = "INVALID_URL" | VoyagerErrorCode;

export type ProfileFetchResult =
  | { ok: true; publicIdentifier: string; data: unknown }
  | { ok: false; error: ProfileFetchError };

export async function fetchRawProfile(
  profileUrl: string,
  session: Session,
): Promise<ProfileFetchResult> {
  const idResult = parseProfileUrl(profileUrl);
  if (!idResult.ok) {
    return { ok: false, error: "INVALID_URL" };
  }

  const { publicIdentifier } = idResult;
  const url =
    `https://www.linkedin.com/voyager/api/identity/dash/profiles` +
    `?q=memberIdentity&memberIdentity=${publicIdentifier}&decorationId=${DECORATION_ID}`;
  const referer = `https://www.linkedin.com/in/${publicIdentifier}/`;

  const result = await voyagerGet(url, session, referer);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, publicIdentifier, data: result.data };
}
