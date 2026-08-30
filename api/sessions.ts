// POST /api/sessions — public bring-your-own-session endpoint. A visitor
// submits their own captured LinkedIn session and gets back a bearer token;
// using that token on /api/profile runs the request on their session
// instead of the shared default. Session values travel in the request body
// only, never the URL — see docs/specs/linkedin-profile-api.md's Phase 3
// security section for why.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { storeVisitorSession } from "../src/sessions/sessionStore.js";
import { apiError, statusForErrorCode } from "../src/utils/errors.js";
import type { ApiErrorCode } from "../src/types/profile.js";

interface SessionSubmission {
  liAt: string;
  jsessionid: string;
  userAgent?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    res
      .status(405)
      .json(apiError("INVALID_SESSION_DATA", "Only POST is supported on this endpoint."));
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

  const result = await storeVisitorSession(submission);
  if (!result) {
    respondError(res, "INTERNAL_ERROR", "Session storage is not configured on the server.");
    return;
  }

  res.status(200).json({ token: result.token });
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
