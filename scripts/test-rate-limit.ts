// Standalone verification script for milestone 6 (extended for ticket 002):
// hammers checkRateLimit() and checkSessionRateLimit() directly against real
// Upstash Redis and confirms requests past each configured limit come back
// limited. Depends on live external state (a real Redis instance), so this
// is the pass/fail signal rather than an automated test — same rationale as
// scripts/verify-session.ts.
//
// Run with: node --env-file=.env --import tsx scripts/test-rate-limit.ts

import { checkRateLimit, checkSessionRateLimit } from "../src/rateLimit/rateLimiter.js";
import type { RateLimitCheck } from "../src/rateLimit/rateLimiter.js";

async function runCheck(
  label: string,
  check: (identifier: string) => Promise<RateLimitCheck>,
  maxRequests: number,
): Promise<boolean> {
  const identifier = `test-${label}-${Date.now()}`;
  console.log(`\n${label}: limit = ${maxRequests} requests per window.`);

  let allowedCount = 0;
  let limitedCount = 0;

  for (let i = 1; i <= maxRequests + 3; i++) {
    const result = await check(identifier);

    if (!result.ok) {
      console.error(`FAIL (${label}): rate limiting is not configured — ${result.error}`);
      console.error("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env first.");
      return false;
    }

    if (result.limited) {
      limitedCount++;
      console.log(`  request ${i}: LIMITED (remaining: ${result.remaining})`);
    } else {
      allowedCount++;
      console.log(`  request ${i}: allowed (remaining: ${result.remaining})`);
    }
  }

  console.log(`  allowed: ${allowedCount}, limited: ${limitedCount}`);

  if (allowedCount === maxRequests && limitedCount === 3) {
    console.log(`PASS (${label}): exactly the configured limit was allowed, the rest were blocked.`);
    return true;
  }

  console.error(`FAIL (${label}): expected ${maxRequests} allowed and 3 limited.`);
  return false;
}

async function main() {
  const profilePass = await runCheck(
    "profile",
    checkRateLimit,
    Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 10),
  );
  const sessionPass = await runCheck(
    "sessions",
    checkSessionRateLimit,
    Number(process.env.SESSION_RATE_LIMIT_MAX_REQUESTS ?? 5),
  );

  process.exit(profilePass && sessionPass ? 0 : 1);
}

main();
