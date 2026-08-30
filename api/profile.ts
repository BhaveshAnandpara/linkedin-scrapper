// GET /api/profile?url=... — public endpoint, orchestrates the pipeline:
// validate -> rate limit -> cache check -> identifier lock -> session ->
// call-slot -> fetch -> parse -> cache write -> respond (release locks/slots
// throughout). See src/linkedin/callConcurrency.ts for why the lock/slot
// exist: concurrent requests for the same profile share one LinkedIn call,
// and total concurrent LinkedIn calls are capped regardless of identifier.

import { randomUUID } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { parseProfileUrl } from "../src/linkedin/identifiers.js";
import { resolveRequestSession } from "../src/linkedin/sessionResolver.js";
import { fetchRawProfile, type ProfileFetchError } from "../src/linkedin/profileFetcher.js";
import { parseProfile } from "../src/linkedin/profileParser.js";
import { getCachedProfile, setCachedProfile, waitForCachedProfile } from "../src/cache/profileCache.js";
import {
  acquireCallSlot,
  releaseCallSlot,
  acquireIdentifierLock,
  releaseIdentifierLock,
} from "../src/linkedin/callConcurrency.js";
import { apiError, respondError } from "../src/utils/errors.js";
import { getClientIp } from "../src/utils/ip.js";
import { checkRateLimit, shouldFailClosed } from "../src/rateLimit/rateLimiter.js";
import type { ApiErrorCode } from "../src/types/profile.js";

const FOLLOWER_WAIT_MS = Number(process.env.LINKEDIN_FOLLOWER_WAIT_MS ?? 8_000);
const AT_CAPACITY_MESSAGE = "LinkedIn is at capacity right now. Please try again shortly.";

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

  const clientIp = getClientIp(req.headers, req.socket?.remoteAddress);
  const rateLimitResult = await checkRateLimit(clientIp);
  if (rateLimitResult.ok && rateLimitResult.limited) {
    respondError(res, "RATE_LIMITED", "Too many requests. Please try again later.");
    return;
  }
  if (!rateLimitResult.ok) {
    if (shouldFailClosed(process.env.VERCEL_ENV)) {
      respondError(
        res,
        "INTERNAL_ERROR",
        "Rate limiting is not configured on this server.",
      );
      return;
    }
    console.warn(
      "Rate limiting is not configured (missing UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN) — proceeding without it.",
    );
  }

  const idResult = parseProfileUrl(profileUrl);
  if (!idResult.ok) {
    respondError(res, "INVALID_URL", "The provided URL is not a valid LinkedIn profile URL.");
    return;
  }

  const cached = await getCachedProfile(idResult.publicIdentifier);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  // Only one concurrent request per identifier actually fetches from
  // LinkedIn; a request that loses this race waits for the winner's result
  // to land in the cache instead of independently repeating the call.
  const leaseId = randomUUID();
  const gotIdentifierLock = await acquireIdentifierLock(idResult.publicIdentifier, leaseId);

  if (!gotIdentifierLock) {
    const waited = await waitForCachedProfile(idResult.publicIdentifier, FOLLOWER_WAIT_MS);
    if (waited) {
      res.status(200).json(waited);
      return;
    }
    respondError(res, "LINKEDIN_AT_CAPACITY", AT_CAPACITY_MESSAGE);
    return;
  }

  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;

    const sessionResult = await resolveRequestSession(bearerToken);
    if (!sessionResult.ok) {
      if (sessionResult.error === "SESSION_EXPIRED") {
        respondError(
          res,
          "SESSION_EXPIRED",
          "The provided session token is invalid, unrecognized, or has expired.",
        );
      } else {
        respondError(res, "INTERNAL_ERROR", "LinkedIn session is not configured on the server.");
      }
      return;
    }

    // Global cap on simultaneous outbound LinkedIn calls, independent of
    // which identifier this is — protects the shared session from a burst
    // across many different profiles at once, which the per-identifier
    // lock above can't see.
    const slot = await acquireCallSlot();
    if (!slot.ok) {
      respondError(res, "LINKEDIN_AT_CAPACITY", AT_CAPACITY_MESSAGE);
      return;
    }

    let fetchResult;
    try {
      fetchResult = await fetchRawProfile(profileUrl, sessionResult.session);
    } finally {
      await releaseCallSlot(slot.leaseId);
    }

    if (!fetchResult.ok) {
      const [code, message] = mapFetchError(fetchResult.error);
      respondError(res, code, message);
      return;
    }

    const parseResult = parseProfile(fetchResult.data, profileUrl);
    if (!parseResult.ok) {
      respondError(
        res,
        "INTERNAL_ERROR",
        "LinkedIn returned a profile response in an unexpected shape.",
      );
      return;
    }

    await setCachedProfile(idResult.publicIdentifier, parseResult.profile);
    res.status(200).json(parseResult.profile);
  } finally {
    await releaseIdentifierLock(idResult.publicIdentifier, leaseId);
  }
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
