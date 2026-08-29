# LinkedIn Profile API — Phase 1 Implementation Plan

## Context

Tross's hiring challenge (deadline 2026-08-31) asks for a hosted API that takes a LinkedIn profile URL and returns structured JSON. A hiring-team clarification made one constraint explicit: no browser automation anywhere in the request-serving path — the solution must call LinkedIn's internal endpoints directly over HTTP.

Since the original Plan Mode pass, the project went through a brainstorming session that selected **Strategy 2**: a manually-captured LinkedIn session cookie as the primary (and, for this plan, *only*) auth mechanism — no automated login. This was validated against how PhantomBuster's own LinkedIn Profile Scraper works in production (same mechanism: manual cookie capture + direct API calls). That decision was then formalized into a finalized specification at `docs/specs/linkedin-profile-api.md`, produced via the to-spec skill, which is now the authoritative source of truth for scope, the API contract, and testing approach. `CLAUDE.md` at the repo root reflects the same framing.

**This plan covers Phase 1 only — the entire required deliverable.** Automated LinkedIn login (Phase 2) is explicitly out of scope here; it's a separate, additive future piece of work only if time remains after Phase 1 ships. Nothing in this plan builds a login flow.

The repo currently contains only docs (`CLAUDE.md`, `docs/specs/linkedin-profile-api.md`, stub `README.md`) — no code yet. Confirmed locally available: Node v20.20.0, npm 10.8.2, git 2.54.0, Vercel CLI 59.10.0 (via `npx`).

## Recommended Approach

### Auth/session (Phase 1 — do not deviate)
The backend reads a LinkedIn session (`li_at` cookie + paired `JSESSIONID` CSRF token) from environment variables, captured once by a human manually logging into LinkedIn in a real browser — outside the deployed system. No login flow runs at request time; there is no `login.ts` in this phase. If LinkedIn rejects the session (401/403), the API returns `SESSION_EXPIRED`; recovery is manual (re-capture cookie → update env var → redeploy).

### Reused from the earlier design doc
An earlier Plan-Mode design pass already researched LinkedIn's Voyager mechanics: the endpoint URL pattern, required headers (`csrf-token` = unquoted JSESSIONID, `x-restli-protocol-version`, `x-li-lang`, `accept`, `user-agent`), the `decorationId` caveat (must be live-verified, drifts over time), and the `vectorImage` → profile-image URL extraction logic. This is still valid Phase 1 material — reuse it directly in `voyagerClient.ts`/`profileFetcher.ts` rather than re-deriving it. That pass's automated-login and Redis-session-storage design is now obsolete and should not be built.

### API contract (verbatim from the spec — do not change)
`ProfileResponse`: `requestedUrl`, `publicIdentifier`, `name`, `headline?`, `location?`, `about?`, `profileImage?`, `profileImages?[]`, `experience[]` (title, company, location?, startDate?, endDate?, isCurrent, description?), `education[]` (school, degree?, fieldOfStudy?, startYear?, endYear?, description?), `skills[]` (name, endorsementCount?), `certifications[]` (name, issuingOrganization?, issueDate?, expirationDate?, credentialUrl?), `languages[]` (name, proficiency?), `meta` (fetchedAt, partial, limitations?).
`ApiErrorResponse`: `{ error: { code, message } }`, codes: `INVALID_URL | PROFILE_NOT_FOUND | PROFILE_PRIVATE | SESSION_EXPIRED | LOGIN_CHALLENGE | LINKEDIN_RATE_LIMITED | RATE_LIMITED | INTERNAL_ERROR`. (`LOGIN_CHALLENGE` exists for Phase 2 forward-compatibility only; never thrown in Phase 1 code.)

### Package choices
- **HTTP client:** native `fetch` (global in Node 20) — no dependency.
- **Test framework:** **Vitest** — zero-config TS/ESM, no prior art in repo so this sets the precedent.
- **URL validation:** dependency-free — native `URL` class + a slug/hostname check in `identifiers.ts`.
- **Script execution:** `tsx` (dev dep) to run `scripts/*.ts` directly.
- **Redis/rate limiting:** `@upstash/redis` + `@upstash/ratelimit`, via the Vercel Marketplace Upstash integration.
- **Vercel types:** `@vercel/node` (dev dep) for `VercelRequest`/`VercelResponse`.

### Standardized env vars
```
LI_AT_COOKIE                 # li_at cookie value, captured manually
LI_JSESSIONID                # JSESSIONID value, paired CSRF token
UPSTASH_REDIS_REST_URL       # from Vercel's Upstash Marketplace integration
UPSTASH_REDIS_REST_TOKEN     # from Vercel's Upstash Marketplace integration
RATE_LIMIT_MAX_REQUESTS      # e.g. 10
RATE_LIMIT_WINDOW_SECONDS    # e.g. 60
PROFILE_CACHE_TTL_SECONDS    # optional caching milestone only, e.g. 3600
```

### Project structure
```
/api
  profile.ts              # GET /api/profile?url=... — Vercel serverless function (Node runtime)
  health.ts                # trivial 200, no LinkedIn call — cheap deploy smoke test
/src
  /linkedin
    voyagerClient.ts        # low-level HTTP: headers/cookies from Session, fetch(), classify response
    session.ts               # reads LI_AT_COOKIE/LI_JSESSIONID from env -> Session | config error
    identifiers.ts            # parseProfileUrl(): URL -> publicIdentifier | INVALID_URL   [TDD seam #2]
    profileFetcher.ts          # (identifier, session) -> raw JSON | typed fetch error
    profileParser.ts            # raw JSON -> ProfileResponse, pure                        [TDD seam #1, primary]
  /cache
    redisClient.ts               # shared @upstash/redis instance
    profileCache.ts               # OPTIONAL/cut-if-time-short: cache ProfileResponse by identifier
  /rateLimit
    rateLimiter.ts                 # @upstash/ratelimit sliding window keyed by client IP
  /types
    linkedin-raw.ts                 # loose raw Voyager JSON types (from recon)
    profile.ts                       # ProfileResponse / ApiErrorResponse contract
  /utils
    errors.ts                         # ApiError + error-code -> HTTP status map
    ip.ts                              # client IP extraction (x-forwarded-for)
    logger.ts                          # redacts LI_AT_COOKIE/LI_JSESSIONID from logs
/scripts
  test-fetch-profile.ts               # standalone: real session + fetch + parse, masked output
  test-rate-limit.ts                   # standalone: hammer local endpoint, confirm 429s
/tests
  identifiers.test.ts
  profileParser.test.ts
  /fixtures                            # SANITIZED (fake names/photos), committed
    profile-full.json / profile-sparse.json / profile-private.json
/reference                             # gitignored — raw recon captures, may contain real cookies/data
.env.example / .gitignore / vercel.json / package.json / tsconfig.json / vitest.config.ts
```

## Critical Files
- `src/linkedin/profileParser.ts` — primary test seam, isolates LinkedIn's undocumented JSON shape
- `src/linkedin/voyagerClient.ts` — raw HTTP mechanics, reuses old design doc's header research
- `src/linkedin/identifiers.ts` — secondary test seam, URL → identifier
- `api/profile.ts` — public endpoint, orchestrates the pipeline
- `src/types/profile.ts` — the API contract, copied verbatim from the spec

## Implementation Steps

**0. Manual recon (no code).** Log into LinkedIn in a real browser with the project's account. DevTools → Network → filter `voyager` → visit own profile + one fully-filled-out profile + one sparse/out-of-network profile. For each: right-click the matching request → Copy as cURL (captures headers + cookies), and save the raw JSON response. Cross-check headers against the old design doc's list; confirm the live `decorationId`. Save all raw captures to gitignored `/reference/`. Extract `li_at`/`JSESSIONID` into a local `.env`. Create **sanitized** copies (fake names/companies/photo URLs, real shape/structure preserved) of the three JSON captures into `tests/fixtures/` — these are what get committed; the raw versions never are, since the repo is public.
*Done when:* 3 raw captures in `/reference/` (gitignored), 3 sanitized fixtures in `tests/fixtures/` (committed), session values + confirmed endpoint/decorationId/headers recorded for milestone 2.

**1. Scaffold.** `package.json` (ESM; scripts: `typecheck`, `test`, `test:watch`, `dev`), `tsconfig.json` (strict, ES2022/NodeNext), full folder structure with stubs, `src/types/profile.ts` (contract copied from spec), `.env.example`, `.gitignore` (`node_modules/`, `.env*`, `/reference/`, `.vercel/`, `dist/`, `coverage/`), `vercel.json`, `vitest.config.ts`. Install deps per package choices above.
*Verify:* `npm install` clean, `npx tsc --noEmit` clean, `npx vitest run` clean, `git status` shows no secrets/`/reference`.
*Commit:* "scaffold project structure and tooling config"

**2. Manual session wired up.** `src/linkedin/session.ts` (env → `Session`), `src/linkedin/voyagerClient.ts` (headers/cookies from `Session`, `fetch()`, classify: 2xx→JSON, 401/403→`SESSION_EXPIRED`, 404→`NOT_FOUND`, 429→`LINKEDIN_RATE_LIMITED`, else→`UPSTREAM_ERROR`).
*Verify:* with local `.env` populated, run a minimal script via `node --env-file=.env --import tsx` hitting the known endpoint+identifier from recon; confirm 200 JSON back, not 401/403.
*Commit:* "wire up LinkedIn session and raw Voyager HTTP client"

**3. Raw profile fetch.** TDD: `tests/identifiers.test.ts` first (valid: with/without protocol, trailing slash, alphanumeric-suffixed slugs; invalid: wrong domain, `/company/` paths, empty/garbage) → implement `identifiers.ts` to green. Then `profileFetcher.ts` (composes identifiers + voyagerClient) and `scripts/test-fetch-profile.ts` (URL in, raw JSON out, session masked in output).
*Verify:* `npx vitest run tests/identifiers.test.ts` green; script run against a real profile confirms shape matches milestone 0's capture.
*Commit (2 checkpoints):* "add identifier resolution (TDD)" → "wire up profile fetcher and manual verification script"

**4. Profile parsing (primary seam).** `src/types/linkedin-raw.ts` from recon; `profileParser.ts` + `tests/profileParser.test.ts` driven by the 3 fixtures. TDD one section at a time: top-level fields → experience[] → education[] → skills[] → certifications[] → languages[] → `profileImage`/`profileImages` (via `vectorImage` extraction). Add sparse-profile test (`meta.partial === true`, missing fields `undefined` not thrown), private-profile test, and a malformed/near-empty resilience test (empty arrays, no crash).
*Verify:* `npx vitest run` full suite green.
*Commit:* "implement profile parser against real captured fixtures (TDD)"

**5. Public endpoint.** `src/utils/errors.ts` (code→status: INVALID_URL→400, PROFILE_NOT_FOUND→404, PROFILE_PRIVATE→403, SESSION_EXPIRED→401, LINKEDIN_RATE_LIMITED→502, RATE_LIMITED→429, INTERNAL_ERROR→500); `api/health.ts` (trivial 200); `api/profile.ts` wiring validate→session→fetch→parse→respond, or typed error→envelope. Rate limiting deferred to step 6.
*Verify:* `vercel dev` locally; real profile URL → well-formed 200; garbage URL → 400 envelope.
*Commit:* "add public profile endpoint with typed error envelope"

**6. Rate limiting.** `src/utils/ip.ts`, `src/rateLimit/rateLimiter.ts` (Upstash sliding window by IP). Wire into `api/profile.ts` after URL validation but before session/fetch work. `scripts/test-rate-limit.ts`.
*Verify:* rapid requests past the limit return 429 quickly; under-limit requests still succeed.
*Commit:* "add per-IP rate limiting ahead of LinkedIn calls"

**7. Deploy.** `npx vercel link`; add Upstash Redis via Vercel Marketplace (auto-populates Upstash env vars); set `LI_AT_COOKIE`/`LI_JSESSIONID`/rate-limit vars via `npx vercel env add` or dashboard; `npx vercel --prod`.
*Verify:* live HTTPS URL returns real 200 JSON for a profile; `/api/health` works; no secrets in repo or build output.

**8. README.** Setup (env vars, how to capture the session cookie, Upstash setup, `vercel dev`), API docs (request/response examples per error code), approach summary (explicit Phase 1/Phase 2 split, Phase 2 noted as not built), known limitations (manual session refresh, ToS/legal risk disclosure, `decorationId` drift risk, private/sparse-profile ambiguity).
*Commit:* "add README with setup, API docs, approach, and limitations"

**Optional, cut-if-time-short — profile cache.** Only after step 8. `src/cache/redisClient.ts` + `profileCache.ts`, short TTL, checked after rate-limit/validation, before fetch. Verify: same URL twice, second call faster / doesn't re-hit LinkedIn. Own commit.

**Phase 2 (not part of this plan).** Automated LinkedIn login is a separate future addition if time remains after step 8 — not built here.

## Verification

- Each step has its own local pass/fail check (type-check, `vitest run`, standalone script output, `vercel dev` local test) — see per-step "Verify" above.
- End-to-end: after deployment, hit the live HTTPS endpoint with a real `linkedin.com/in/...` URL and confirm a well-formed `ProfileResponse`.
- `git status`/repo contents confirmed free of `.env`, raw cookies, or `/reference` contents before any push — only sanitized fixtures ship.
- Rate limiting: rapid local requests confirm 429 before LinkedIn is ever called.
