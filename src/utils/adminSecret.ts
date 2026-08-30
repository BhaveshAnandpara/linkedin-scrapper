// Constant-time comparison for the admin secret guarding the default-
// session refresh endpoint. Timing-safe: a naive `===` comparison leaks
// how many leading characters matched via response-time differences, which
// matters here since this secret guards write access to the session
// powering all unauthenticated public traffic.

import { timingSafeEqual } from "node:crypto";

export function verifyAdminSecret(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) {
    return false;
  }

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(providedBuf, expectedBuf);
}
