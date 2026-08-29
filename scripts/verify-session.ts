// Standalone verification script for milestone 2: confirms the session in
// .env can successfully authenticate against LinkedIn's Voyager API.
// Run with: node --env-file=.env --import tsx scripts/verify-session.ts
//
// This is a manual pass/fail check, not an automated test — it depends on a
// live external session, which can't be meaningfully mocked (see the
// spec's Testing Decisions section).

import { getSession } from "../src/linkedin/session.js";
import { voyagerGet } from "../src/linkedin/voyagerClient.js";

const KNOWN_PUBLIC_IDENTIFIER = "bhavesh-anandpara";
const DECORATION_ID =
  "com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93";

async function main() {
  const sessionResult = getSession();
  if (!sessionResult.ok) {
    console.error("FAIL: session not configured —", sessionResult.error);
    console.error("Set LI_AT_COOKIE and LI_JSESSIONID in .env first.");
    process.exit(1);
  }

  const url =
    `https://www.linkedin.com/voyager/api/identity/dash/profiles` +
    `?q=memberIdentity&memberIdentity=${KNOWN_PUBLIC_IDENTIFIER}&decorationId=${DECORATION_ID}`;
  const referer = `https://www.linkedin.com/in/${KNOWN_PUBLIC_IDENTIFIER}/`;

  const result = await voyagerGet(url, sessionResult.session, referer);

  if (result.ok) {
    const data = result.data as { elements?: unknown[] };
    console.log("PASS: got 200 JSON back.");
    console.log("  elements present:", Array.isArray(data.elements));
    console.log("  element count:", data.elements?.length ?? 0);
    process.exit(0);
  }

  console.error(`FAIL: ${result.error}${result.status ? ` (HTTP ${result.status})` : ""}`);
  if (result.error === "SESSION_EXPIRED") {
    console.error("The session in .env is stale — re-capture li_at/JSESSIONID from a live browser session.");
  }
  process.exit(1);
}

main();
