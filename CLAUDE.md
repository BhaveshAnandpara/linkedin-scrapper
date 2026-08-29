# LinkedIn Profile API

## Project

This repo is a submission for Tross's hiring challenge: a hosted API that accepts a LinkedIn profile URL and returns most of the information on that profile (name, headline, location, about, experience, education, skills, certifications, languages, profile images) as structured JSON.

**Hard constraint (from the hiring team's clarification):** the solution must reverse-engineer and call LinkedIn's internal API endpoints directly over HTTP. No browser automation (Puppeteer/Playwright/Selenium or similar) is allowed anywhere in the request-serving path.

Full technical design lives in `C:\Users\bhave\.claude\plans\addition-to-problem-statement-sharded-thompson.md` — refer back to it during implementation.

## Goals

- Deploy the API publicly over HTTPS.
- Accept a LinkedIn profile URL as input, return structured JSON with: name, headline, location, about, experience, education, skills, certifications, languages, profile images.
- Backend authenticates to LinkedIn using our own credentials (automated login against LinkedIn's internal endpoints — see design doc for the flow and its accepted risks).
- Submit a public GitHub repo with complete source, plus a README covering setup, API docs, approach, and known limitations.
- No credentials or secrets ever committed to the repo.

**Deadline: 2026-08-31.**

## Approach (summary)

- **Stack:** Node.js + TypeScript, deployed on Vercel (serverless functions).
- **LinkedIn access:** Reverse-engineered "Voyager" API (LinkedIn's own internal API, called directly via HTTP) — no browser involved at request time.
- **Auth strategy — Strategy 2 (manual session primary, automated login as stretch):**
  - **Phase 1 (core, required for submission):** the backend reads a manually captured LinkedIn session cookie from env vars (`LI_AT_COOKIE`, `LI_JSESSIONID`) and uses it directly on every request. No login flow runs at request time at all — `src/linkedin/login.ts` is not built in phase 1. If LinkedIn rejects the session, the API returns a clear `SESSION_EXPIRED` error; refreshing means updating the env var and redeploying. This is a deliberate trade: it drops the riskiest, most fragile part of the project (automated login fighting LinkedIn's bot detection) in favor of putting build time into the actual reverse-engineered profile-fetching/parsing work.
  - **Phase 2 (stretch, only if time remains after phase 1 is deployed and working):** build the automated username/password login flow (bootstrap cookies → POST to LinkedIn's auth endpoint → detect success/challenge/failure). On `SESSION_EXPIRED`, attempt one automated re-login instead of erroring, and cache the new session in Upstash Redis so it survives across stateless Vercel invocations. Purely additive — the phase 1 manual-session path keeps working as a fallback even after phase 2 ships.
- **Redis (Upstash):** used for rate limiting from phase 1 onward (essential regardless of auth strategy — protects the account from abuse), and optionally a short-TTL cache of profile responses to reduce repeat hits to LinkedIn. Session storage in Redis only becomes relevant in phase 2.
- **Public endpoint:** open (no required API key), but rate-limited per IP to protect the backing LinkedIn account from abuse.

See the design doc above for exact endpoints, headers, login flow mechanics, project structure, and response schema (the design doc predates the phase 1/phase 2 split above — treat this file as the current source of truth on auth sequencing).

## Milestones

Each milestone should be verified before moving to the next, and committed once verified.

**Phase 1 — required for submission**

| # | Milestone | Done when |
|---|---|---|
| 0 | Manual recon | Real LinkedIn profile endpoint, headers, and current `decorationId` captured from a live browser session, saved to gitignored `/reference/`. The session cookie captured here (`li_at` + `JSESSIONID`) is the literal credential the deployed API will run on in phase 1 — not just reference material. |
| 1 | Scaffold | Project structure, types, `.env.example`, `vercel.json` in place; `tsc --noEmit` clean |
| 2 | Manual session wired up | `voyagerClient` reads `LI_AT_COOKIE`/`LI_JSESSIONID` from env and successfully authenticates a request to LinkedIn |
| 3 | Raw profile fetch | One real profile fetched from the Voyager endpoint using the manual session, raw JSON shape matches step 0's capture |
| 4 | Profile parsing | `profileParser.ts` turns raw JSON into the clean `ProfileResponse` schema across a few varied test profiles |
| 5 | Public endpoint | `GET /api/profile?url=...` works end-to-end locally via `vercel dev` |
| 6 | Rate limiting | Rapid local requests correctly return `429` before hitting LinkedIn |
| 7 | Deployed | Live HTTPS Vercel URL returns a real profile response using the manual session; no secrets in repo/build output |
| 8 | README | Setup, API docs, approach, and known-limitations sections complete (including the manual-session-refresh limitation) |

**Phase 2 — stretch, only if time remains**

| # | Milestone | Done when |
|---|---|---|
| 9 | Automated login | `scripts/test-login.ts` logs in against real credentials and reports success/challenge clearly |
| 10 | Session self-healing | On `SESSION_EXPIRED`, the API automatically re-logs in, caches the new session in Redis, and retries — manual session env vars become the fallback rather than the only path |

## Development Philosophy

- **Small, verified chunks.** Build one milestone at a time, not the whole thing in one pass. Verify each one actually works before moving to the next.
- **TDD where it's meaningful.** For pure logic — URL/identifier parsing, raw-JSON-to-response mapping — write a failing test first, confirm it fails, then implement until it passes. For steps that depend on a live external system with real side effects (LinkedIn login, live Voyager calls), traditional TDD doesn't apply well since there's no meaningful way to mock LinkedIn without losing signal — use the standalone verification scripts (`scripts/test-login.ts`, `scripts/test-fetch-profile.ts`) as the pass/fail signal instead.
- **Always give a clear pass/fail signal.** Don't consider a step done because it "looks right" — run it and check.
- **Commit at each verified checkpoint**, not just once at the end, so there's always a safe point to roll back to.
- **Keep context tight.** Don't let exploration wander past what the current chunk needs; push isolated research (e.g. LinkedIn endpoint investigation) into standalone scripts rather than bloating the main working session.
- **Plan Mode before anything risky or wide-reaching.** This project's implementation plan was produced that way — revisit Plan Mode if the approach needs to change significantly mid-build.

## Known Risk Areas (keep in mind throughout)

- **(Phase 1)** The manually captured session cookie will eventually expire, and there's no automated recovery until phase 2 exists — expect to refresh it (re-capture + update env var + redeploy) at least once before the deadline. Document this plainly in the README rather than hiding it.
- **(Phase 2, if attempted)** LinkedIn's automated login can be checkpointed (CAPTCHA/2FA) — especially likely from a datacenter IP. Treat this as expected, not exceptional; fail loudly and cleanly rather than retrying blindly. Phase 1's manual session stays as the fallback if phase 2 doesn't pan out.
- LinkedIn's internal API is undocumented and shifts over time (e.g. the `decorationId` value). Keep raw-fetch and parsing logic strictly separated so drift only breaks one layer.
- This approach violates LinkedIn's User Agreement — the account used is at risk of restriction. State this plainly in the README rather than glossing over it.
