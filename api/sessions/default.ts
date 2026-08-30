// POST /api/sessions/default — admin-only. Refreshes the shared/default
// LinkedIn session that powers unauthenticated /api/profile requests,
// replacing "update the env var and redeploy" with one authenticated
// request. Guarded by a secret distinct from any visitor-facing
// credential, sent as X-Admin-Secret (not Authorization, to keep this
// visually/mechanically separate from visitor bearer tokens) and compared
// in constant time.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { storeDefaultSession, parseSessionSubmission } from "../../src/sessions/sessionStore.js";
import { verifyAdminSecret } from "../../src/utils/adminSecret.js";
import { apiError, respondError } from "../../src/utils/errors.js";
import { getClientIp } from "../../src/utils/ip.js";
import { checkSessionRateLimit, shouldFailClosed } from "../../src/rateLimit/rateLimiter.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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

  const providedSecret = req.headers["x-admin-secret"];
  const secret = Array.isArray(providedSecret) ? providedSecret[0] : providedSecret;
  if (!verifyAdminSecret(secret, process.env.ADMIN_SECRET)) {
    respondError(res, "UNAUTHORIZED", "Unauthorized.");
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

  const stored = await storeDefaultSession(submission);
  if (!stored) {
    respondError(res, "INTERNAL_ERROR", "Session storage is not configured on the server.");
    return;
  }

  res.status(200).json({ ok: true });
}
