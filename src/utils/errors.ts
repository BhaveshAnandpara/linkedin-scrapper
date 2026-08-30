// ApiErrorCode -> HTTP status map, plus a small helper for building the
// ApiErrorResponse envelope. Every code in the contract must appear here
// (TS enforces this via the Record type) so a new error code can't be added
// to profile.ts without also being given a status.

import type { ApiErrorCode, ApiErrorResponse } from "../types/profile.js";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  INVALID_URL: 400,
  PROFILE_NOT_FOUND: 404,
  PROFILE_PRIVATE: 403,
  SESSION_EXPIRED: 401,
  LOGIN_CHALLENGE: 401,
  LINKEDIN_RATE_LIMITED: 502,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  INVALID_SESSION_DATA: 400,
};

export function statusForErrorCode(code: ApiErrorCode): number {
  return STATUS_BY_CODE[code];
}

export function apiError(code: ApiErrorCode, message: string): ApiErrorResponse {
  return { error: { code, message } };
}
