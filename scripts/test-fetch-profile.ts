// Standalone verification script for milestone 3: given a LinkedIn profile
// URL, fetches the raw Voyager JSON and prints a summary. Session values
// are never printed — this is a manual pass/fail check, not an automated
// test, since it depends on live external state (see spec Testing Decisions).
//
// Run with: node --env-file=.env --import tsx scripts/test-fetch-profile.ts <profileUrl>

import { getSession } from "../src/linkedin/session.js";
import { fetchRawProfile } from "../src/linkedin/profileFetcher.js";

interface RawProfileTopLevel {
  headline?: string;
  summary?: string;
  profilePositionGroups?: { paging?: { total?: number } };
  profileEducations?: { paging?: { total?: number } };
  profileSkills?: { paging?: { total?: number } };
}

async function main() {
  const profileUrl = process.argv[2];
  if (!profileUrl) {
    console.error("usage: node --env-file=.env --import tsx scripts/test-fetch-profile.ts <linkedin-profile-url>");
    process.exit(1);
  }

  const sessionResult = getSession();
  if (!sessionResult.ok) {
    console.error("FAIL: session not configured —", sessionResult.error);
    process.exit(1);
  }

  const result = await fetchRawProfile(profileUrl, sessionResult.session);
  if (!result.ok) {
    console.error("FAIL:", result.error);
    process.exit(1);
  }

  console.log("PASS. publicIdentifier:", result.publicIdentifier);
  const data = result.data as { elements?: RawProfileTopLevel[] };
  console.log("elements:", data.elements?.length ?? 0);

  const profile = data.elements?.[0];
  if (profile) {
    console.log("  headline present:", !!profile.headline);
    console.log("  summary present:", !!profile.summary);
    console.log("  positions total:", profile.profilePositionGroups?.paging?.total ?? "n/a");
    console.log("  educations total:", profile.profileEducations?.paging?.total ?? "n/a");
    console.log("  skills total:", profile.profileSkills?.paging?.total ?? "n/a");
  }
}

main();
