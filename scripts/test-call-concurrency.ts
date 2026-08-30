// Standalone verification script for ticket 007: exercises the global
// call-slot cap and per-identifier fetch lock against real Upstash Redis.
// Only touches Redis, never LinkedIn — safe to run as often as needed
// without risking the live session, unlike scripts/verify-session.ts.
//
// Run with: node --env-file=.env --import tsx scripts/test-call-concurrency.ts

import { randomUUID } from "node:crypto";
import {
  acquireCallSlot,
  releaseCallSlot,
  acquireIdentifierLock,
  releaseIdentifierLock,
} from "../src/linkedin/callConcurrency.js";

async function testCallSlotCap(): Promise<boolean> {
  const maxConcurrent = Number(process.env.LINKEDIN_MAX_CONCURRENT_CALLS ?? 5);
  console.log(`\ncall-slot cap: limit = ${maxConcurrent} concurrent.`);

  const acquired: string[] = [];
  for (let i = 1; i <= maxConcurrent; i++) {
    const result = await acquireCallSlot();
    if (!result.ok) {
      console.error(`FAIL: expected slot ${i}/${maxConcurrent} to be acquirable, but it wasn't.`);
      return false;
    }
    acquired.push(result.leaseId);
  }
  console.log(`  acquired ${acquired.length}/${maxConcurrent} slots.`);

  const overflow = await acquireCallSlot();
  if (overflow.ok) {
    console.error("FAIL: acquired a slot beyond the configured limit.");
    return false;
  }
  console.log("  slot beyond the limit correctly rejected.");

  const [firstLeaseId, ...remainingLeaseIds] = acquired;
  if (firstLeaseId) {
    await releaseCallSlot(firstLeaseId);
  }
  const afterRelease = await acquireCallSlot();
  if (!afterRelease.ok) {
    console.error("FAIL: releasing a slot did not free capacity for a new acquire.");
    return false;
  }
  console.log("  releasing a slot freed capacity again.");

  for (const leaseId of remainingLeaseIds) {
    await releaseCallSlot(leaseId);
  }
  if (afterRelease.ok) {
    await releaseCallSlot(afterRelease.leaseId);
  }

  console.log("PASS: call-slot cap enforced and released correctly.");
  return true;
}

async function testIdentifierLock(): Promise<boolean> {
  const identifier = `test-lock-${randomUUID()}`;
  console.log(`\nidentifier lock: identifier = ${identifier}`);

  const leaseA = randomUUID();
  const leaseB = randomUUID();

  const first = await acquireIdentifierLock(identifier, leaseA);
  const second = await acquireIdentifierLock(identifier, leaseB);

  if (!first) {
    console.error("FAIL: first acquire for a fresh identifier should have succeeded.");
    return false;
  }
  if (second) {
    console.error("FAIL: second concurrent acquire for the same identifier should have failed.");
    return false;
  }
  console.log("  only the first concurrent acquire succeeded, as expected.");

  await releaseIdentifierLock(identifier, leaseA);
  const third = await acquireIdentifierLock(identifier, leaseB);
  if (!third) {
    console.error("FAIL: acquire after release should have succeeded.");
    return false;
  }
  console.log("  acquire after release succeeded.");

  await releaseIdentifierLock(identifier, leaseB);
  console.log("PASS: identifier lock enforced and released correctly.");
  return true;
}

async function main() {
  const slotPass = await testCallSlotCap();
  const lockPass = await testIdentifierLock();
  process.exit(slotPass && lockPass ? 0 : 1);
}

main();
