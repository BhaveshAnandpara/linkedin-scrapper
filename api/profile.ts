// GET /api/profile?url=... — public endpoint, orchestrates the pipeline:
// validate -> session -> fetch -> parse -> respond. Rate limiting is added
// in milestone 6, ahead of the session/fetch work.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSession } from "../src/linkedin/session.js";
import { fetchRawProfile, type ProfileFetchError } from "../src/linkedin/profileFetcher.js";
import { parseProfile } from "../src/linkedin/profileParser.js";
import { apiError, statusForErrorCode } from "../src/utils/errors.js";
import type { ApiErrorCode } from "../src/types/profile.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "GET") {
    res.status(405).json(apiError("INVALID_URL", "Only GET is supported on this endpoint."));
    return;
  }

  const urlParam = req.query.url;
  const profileUrl = Array.isArray(urlParam) ? urlParam[0] : urlParam;

  if (!profileUrl) {
    respondError(res, "INVALID_URL", "Missing required 'url' query parameter.");
    return;
  }

  const sessionResult = getSession();
  if (!sessionResult.ok) {
    respondError(res, "INTERNAL_ERROR", "LinkedIn session is not configured on the server.");
    return;
  }

  const fetchResult = await fetchRawProfile(profileUrl, sessionResult.session);
  if (!fetchResult.ok) {
    const [code, message] = mapFetchError(fetchResult.error);
    respondError(res, code, message);
    return;
  }

  const parseResult = parseProfile(fetchResult.data, profileUrl);
  if (!parseResult.ok) {
    respondError(res, "INTERNAL_ERROR", "LinkedIn returned a profile response in an unexpected shape.");
    return;
  }

  res.status(200).json(parseResult.profile);
}

function mapFetchError(error: ProfileFetchError): [ApiErrorCode, string] {
  switch (error) {
    case "INVALID_URL":
      return ["INVALID_URL", "The provided URL is not a valid LinkedIn profile URL."];
    case "SESSION_EXPIRED":
      return ["SESSION_EXPIRED", "The LinkedIn session has expired and needs to be refreshed."];
    case "NOT_FOUND":
      return ["PROFILE_NOT_FOUND", "No profile was found at that URL (it may also be private)."];
    case "LINKEDIN_RATE_LIMITED":
      return ["LINKEDIN_RATE_LIMITED", "LinkedIn is rate-limiting this session; try again later."];
    case "UPSTREAM_ERROR":
    default:
      return ["INTERNAL_ERROR", "Unexpected error while fetching the profile from LinkedIn."];
  }
}

function respondError(res: VercelResponse, code: ApiErrorCode, message: string): void {
  res.status(statusForErrorCode(code)).json(apiError(code, message));
}
