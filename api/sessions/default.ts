// POST /api/sessions/default — admin-only. Refreshes the shared/default
// LinkedIn session that powers unauthenticated /api/profile requests,
// replacing "update the env var and redeploy" with one authenticated
// request. Guarded by a secret distinct from any visitor-facing
// credential, sent as X-Admin-Secret (not Authorization, to keep this
// visually/mechanically separate from visitor bearer tokens) and compared
// in constant time.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { storeDefaultSession } from "../../src/sessions/sessionStore.js";
import { verifyAdminSecret } from "../../src/utils/adminSecret.js";
import { apiError, statusForErrorCode } from "../../src/utils/errors.js";
import type { ApiErrorCode } from "../../src/types/profile.js";

interface SessionSubmission {
  liAt: string;
  jsessionid: string;
  userAgent?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res
      .status(405)
      .json(apiError("INVALID_SESSION_DATA", "Only POST is supported on this endpoint."));
    return;
  }

  const providedSecret = req.headers["x-admin-secret"];
  const secret = Array.isArray(providedSecret) ? providedSecret[0] : providedSecret;
  if (!verifyAdminSecret(secret, process.env.ADMIN_SECRET)) {
    respondError(res, "UNAUTHORIZED", "Unauthorized.");
    return;
  }

  const submission = parseSubmission(req.body);
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

function parseSubmission(body: unknown): SessionSubmission | null {
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

function respondError(res: VercelResponse, code: ApiErrorCode, message: string): void {
  res.status(statusForErrorCode(code)).json(apiError(code, message));
}
