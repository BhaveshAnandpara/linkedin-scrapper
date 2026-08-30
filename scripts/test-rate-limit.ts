// Standalone verification script for milestone 6: hammers checkRateLimit()
// directly against real Upstash Redis and confirms requests past the
// configured limit come back limited. Depends on live external state
// (a real Redis instance), so this is the pass/fail signal rather than an
// automated test — same rationale as scripts/verify-session.ts.
//
// Run with: node --env-file=.env --import tsx scripts/test-rate-limit.ts

import { checkRateLimit } from "../src/rateLimit/rateLimiter.js";

async function main() {
  const maxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 10);
  const identifier = `test-rate-limit-${Date.now()}`;

  console.log(`Testing with a fresh identifier, limit = ${maxRequests} requests per window.`);

  let allowedCount = 0;
  let limitedCount = 0;
  let notConfigured = false;

  for (let i = 1; i <= maxRequests + 3; i++) {
    const result = await checkRateLimit(identifier);

    if (!result.ok) {
      console.error(`FAIL: rate limiting is not configured — ${result.error}`);
      console.error("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in .env first.");
      notConfigured = true;
      break;
    }

    if (result.limited) {
      limitedCount++;
      console.log(`  request ${i}: LIMITED (remaining: ${result.remaining})`);
    } else {
      allowedCount++;
      console.log(`  request ${i}: allowed (remaining: ${result.remaining})`);
    }
  }

  if (notConfigured) {
    process.exit(1);
  }

  console.log(`\nallowed: ${allowedCount}, limited: ${limitedCount}`);

  if (allowedCount === maxRequests && limitedCount === 3) {
    console.log("PASS: exactly the configured limit was allowed, the rest were blocked.");
    process.exit(0);
  }

  console.error(`FAIL: expected ${maxRequests} allowed and 3 limited.`);
  process.exit(1);
}

main();
