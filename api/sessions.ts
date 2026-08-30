// POST /api/sessions — public bring-your-own-session endpoint. A visitor
// submits their own captured LinkedIn session and gets back a bearer token;
// using that token on /api/profile runs the request on their session
// instead of the shared default. Session values travel in the request body
// only, never the URL — see docs/specs/linkedin-profile-api.md's Phase 3
// security section for why.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { storeVisitorSession, parseSessionSubmission } from "../src/sessions/sessionStore.js";
import { apiError, respondError } from "../src/utils/errors.js";
import { getClientIp } from "../src/utils/ip.js";
import { checkSessionRateLimit, shouldFailClosed } from "../src/rateLimit/rateLimiter.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    res
      .status(405)
      .json(apiError("INVALID_SESSION_DATA", "Only POST is supported on this endpoint."));
    return;
  }

  const clientIp = getClientIp(req.headers, req.socket?.remoteAddress);
  const rateLimitResult = await checkSessionRateLimit(clientIp);
  if (rateLimitResult.ok && rateLimitResult.limited) {
    respondError(res, "RATE_LIMITED", "Too many requests. Please try again later.");
    return;
  }
  if (!rateLimitResult.ok && shouldFailClosed(process.env.VERCEL_ENV)) {
    respondError(res, "INTERNAL_ERROR", "Rate limiting is not configured on this server.");
    return;
  }

  const submission = parseSessionSubmission(req.body);
  if (!submission) {
    respondError(
      res,
      "INVALID_SESSION_DATA",
      "Request body must include non-empty 'liAt' and 'jsessionid' fields.",
    );
    return;
  }

  const result = await storeVisitorSession(submission);
  if (!result) {
    respondError(res, "INTERNAL_ERROR", "Session storage is not configured on the server.");
    return;
  }

  res.status(200).json({ token: result.token });
}
