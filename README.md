# LinkedIn Profile API

A hosted API that takes a LinkedIn profile URL and returns structured JSON — name, headline, location, about, experience, education, skills, certifications, languages, and profile images.

**Live:** https://linkedin-scrapper-taupe.vercel.app
**Example:** `GET /api/profile?url=https://www.linkedin.com/in/someone/`

This is a submission for Tross's hiring challenge. Per the challenge's explicit clarification, it does **not** use any browser automation (no Puppeteer/Playwright/Selenium) anywhere in the request path — it reverse-engineers and calls LinkedIn's internal "Voyager" API directly over HTTP, the same way LinkedIn's own web client does.

## ⚠️ Legal / risk disclosure

This technique violates LinkedIn's User Agreement. The LinkedIn account whose session powers this API is at real risk of restriction or ban. This is a hiring-challenge submission built to demonstrate the reverse-engineering and system-design work involved — not a product intended for production traffic against real users' accounts. Anyone running this themselves should understand and accept that risk for their own account.

## How it works (approach)

- **Auth strategy — manual session only (no automated login).** A LinkedIn session (`li_at` cookie + paired `JSESSIONID` CSRF token) is captured once by a human logging into LinkedIn in a real browser. There is no login flow in the deployed code — nothing resembling a bot logging into LinkedIn ever runs at request time, ever, in any of the three ways a session can reach this API (see below). This was a deliberate scope decision: it trades away the riskiest, most bot-detection-prone part of a project like this (automated login) in favor of putting the available time into the actual profile-fetching and parsing work, which is the part the challenge is actually testing.
- **Where a session comes from, per request (Phase 3):** (1) a visitor's own bearer token, if they submitted their own session via `POST /api/sessions` — see API docs below; (2) otherwise, a shared "default" session stored in Redis, refreshable by the account owner via the admin-only `POST /api/sessions/default` with **no redeploy required**; (3) otherwise, the original `LI_AT_COOKIE`/`LI_JSESSIONID` env vars, as a last-resort fallback if Redis is ever unreachable. This exists because the shared session in practice expires fast under normal use, and originally the only fix was re-capturing the cookie and redeploying — now it's one authenticated request, and a reviewer whose test happens to catch the shared session down can bring their own instead.
- **Data source — LinkedIn's Voyager API.** LinkedIn's current web frontend renders profile pages via a newer React Server Components / server-driven-UI pipeline that doesn't cleanly expose profile data as JSON. Older REST-style Voyager endpoints (`/voyager/api/identity/profiles/{id}/...`) are deliberately dead (`410 Gone`). What still works — and is what this project uses — is a REST-style "dash" endpoint:
  ```
  GET https://www.linkedin.com/voyager/api/identity/dash/profiles
      ?q=memberIdentity&memberIdentity={publicIdentifier}
      &decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93
  ```
  It returns the full profile — name, headline, summary, positions, education, skills, certifications, languages, images — inline in one response, keyed off the public profile slug (`linkedin.com/in/{publicIdentifier}`).
- **Pipeline:** `parseProfileUrl` (URL → identifier) → `voyagerGet` (authenticated HTTP call, classifies the response) → `parseProfile` (raw undocumented JSON → the stable `ProfileResponse` contract below). Raw-fetch and parsing are kept strictly separate so that when LinkedIn's undocumented shape drifts, only the parser needs fixing.
- **Stack:** Node.js + TypeScript on Vercel serverless functions, Upstash Redis (REST API) for per-IP rate limiting.
- **Testing:** the parser (`profileParser.ts`) and URL-identifier resolution (`identifiers.ts`) are pure functions, TDD'd with real captured fixtures — the highest-value seam, since LinkedIn's undocumented JSON shape is exactly what's expected to drift over time. Everything touching live external state (the LinkedIn session, the live fetch, Upstash) is instead verified with standalone scripts against the real services (`scripts/*.ts`), since mocking a session or a third-party's undocumented API would test the mock, not the real behavior.

**Phase 2 (not built):** automated username/password login with session self-healing on expiry was scoped as a stretch goal, only to be attempted if time remained after Phase 1 shipped and was verified working end-to-end. It wasn't attempted — the manual-session approach above is the entire, complete submission.

**Phase 3 (built, additive):** bring-your-own-session — see above. Unrelated to and independent of Phase 2; it changes *where* an already-manually-captured session lives and *who* it belongs to, not *how* it's obtained. Full design rationale in `docs/specs/linkedin-profile-api.md`.

## Setup

### Prerequisites

- Node.js 20+
- A LinkedIn account (used only to capture a session — never stored anywhere but your own `.env`)
- A free [Upstash](https://console.upstash.com) Redis database (REST API), for rate limiting
- A [Vercel](https://vercel.com) account, if you want to deploy your own copy

### 1. Install

```bash
git clone https://github.com/BhaveshAnandpara/linkedin-scrapper.git
cd linkedin-scrapper
npm install
```

### 2. Capture a LinkedIn session

1. Log into LinkedIn in a normal browser.
2. Open DevTools → Application/Storage → Cookies → `https://www.linkedin.com`.
3. Copy the values of the `li_at` and `JSESSIONID` cookies (the `JSESSIONID` value includes surrounding quotes in the browser — copy it as-is, quotes and all, or without them; the code strips them either way).
4. Copy `.env.example` to `.env` and paste them in:
   ```
   LI_AT_COOKIE=<your li_at value>
   LI_JSESSIONID=<your JSESSIONID value>
   ```

This session **will expire** — see [Known Limitations](#known-limitations) below. As of Phase 3, refreshing it no longer requires a redeploy — see step 4 below.

### 3. Set up rate limiting (Upstash Redis)

1. Create a free Redis database at [console.upstash.com](https://console.upstash.com).
2. On its dashboard, find the **REST API** section (not the Redis-protocol connection string) and copy the REST URL and REST token.
3. Add them to `.env`:
   ```
   UPSTASH_REDIS_REST_URL=<your REST URL>
   UPSTASH_REDIS_REST_TOKEN=<your REST token>
   ```

If these are left unset, rate limiting **fails open** (a warning is logged and requests proceed unlimited) rather than the whole API refusing to start — useful for local dev, but you should configure it for any real deployment.

### 4. Set an admin secret (Phase 3 — bring-your-own-session)

Generate a long random value and add it to `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```
ADMIN_SECRET=<the generated value>
```

This guards `POST /api/sessions/default` — from now on, refreshing the session that powers unauthenticated requests is one authenticated call, not a redeploy:

```bash
curl -X POST https://<your-deployment>/api/sessions/default \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: <your ADMIN_SECRET>" \
  -d '{"liAt": "<fresh li_at>", "jsessionid": "<fresh JSESSIONID>"}'
```

### 5. Run tests / type-check

```bash
npm run typecheck
npm test
```

### 6. Verify against the real LinkedIn API

Vercel's local dev server (`vercel dev`) requires an interactive browser login, so the pipeline is instead verified with standalone scripts that call the same code directly:

```bash
node --env-file=.env --import tsx scripts/verify-session.ts        # session -> raw HTTP call
node --env-file=.env --import tsx scripts/test-fetch-profile.ts <linkedin-profile-url>
node --env-file=.env --import tsx scripts/test-endpoint.ts <linkedin-profile-url>   # full api/profile.ts pipeline
node --env-file=.env --import tsx scripts/test-rate-limit.ts       # hammers the limiter against real Redis
node --env-file=.env --import tsx scripts/test-sessions.ts <linkedin-profile-url>   # bring-your-own-session pipeline
```

### 7. Deploy your own copy

```bash
npx vercel login
npx vercel link
npx vercel env add LI_AT_COOKIE production
npx vercel env add LI_JSESSIONID production
npx vercel env add UPSTASH_REDIS_REST_URL production
npx vercel env add UPSTASH_REDIS_REST_TOKEN production
npx vercel env add ADMIN_SECRET production
npx vercel --prod
```

## API

### `GET /api/health`

Trivial liveness check, no LinkedIn call.

```json
{ "status": "ok" }
```

### `GET /api/profile?url=<linkedin-profile-url>`

```bash
curl "https://linkedin-scrapper-taupe.vercel.app/api/profile?url=https://www.linkedin.com/in/someone/"
```

**200 — success:**

```json
{
  "requestedUrl": "https://www.linkedin.com/in/someone/",
  "publicIdentifier": "someone",
  "name": "Jane Doe",
  "headline": "Software Engineer",
  "location": "San Francisco, California, United States",
  "about": "...",
  "profileImage": { "url": "https://...", "width": 800, "height": 800 },
  "profileImages": [{ "url": "https://...", "width": 800, "height": 800 }],
  "experience": [
    {
      "title": "Software Engineer",
      "company": "Example Corp",
      "location": "San Francisco",
      "startDate": { "month": 7, "year": 2024 },
      "endDate": null,
      "isCurrent": true,
      "description": "..."
    }
  ],
  "education": [
    { "school": "Example University", "degree": "B.Tech", "fieldOfStudy": "Computer Science", "startYear": 2020, "endYear": 2024 }
  ],
  "skills": [{ "name": "TypeScript" }],
  "certifications": [{ "name": "...", "issuingOrganization": "...", "credentialUrl": "..." }],
  "languages": [{ "name": "English", "proficiency": "Professional Working" }],
  "meta": {
    "fetchedAt": "2026-08-30T08:25:25.491Z",
    "partial": true,
    "limitations": ["skills: showing 20 of 56"]
  }
}
```

`meta.partial` is `true` whenever a section is paginated beyond what LinkedIn returned in this single call (e.g. only the first 20 of 56 skills) — `meta.limitations` lists exactly which sections were truncated. Any optional field LinkedIn didn't return is simply omitted rather than causing an error.

Optionally pass `Authorization: Bearer <token>` (see `POST /api/sessions` below) to run the request on your own LinkedIn session instead of the shared one.

### `POST /api/sessions` — bring your own session

Submit your own captured LinkedIn session and get back a bearer token that runs your later `/api/profile` requests on your session, independent of the shared one. Session values go in the **body only** — never as URL query params, since a URL leaks into access logs, browser history, and `Referer` headers in a way a body doesn't.

```bash
curl -X POST https://linkedin-scrapper-taupe.vercel.app/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"liAt": "<your li_at>", "jsessionid": "<your JSESSIONID>"}'
```

```json
{ "token": "c3321765-8ee0-4e81-bc4b-ddc2be5edaea" }
```

Then use it:

```bash
curl -H "Authorization: Bearer c3321765-8ee0-4e81-bc4b-ddc2be5edaea" \
  "https://linkedin-scrapper-taupe.vercel.app/api/profile?url=https://www.linkedin.com/in/someone/"
```

Tokens last 7 days. There's no account system or token-recovery flow — if you lose a token, just submit your session again for a new one. An unrecognized token is rejected outright (`401 SESSION_EXPIRED`) rather than silently falling back to the shared session.

### `POST /api/sessions/default` — admin: refresh the shared session

Admin-only, guarded by `X-Admin-Secret` (see Setup). Updates the shared session that powers every `/api/profile` request made without a bearer token — this is how the deployed session gets refreshed now, without a redeploy.

```bash
curl -X POST https://linkedin-scrapper-taupe.vercel.app/api/sessions/default \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: <your ADMIN_SECRET>" \
  -d '{"liAt": "<fresh li_at>", "jsessionid": "<fresh JSESSIONID>"}'
```

```json
{ "ok": true }
```

**Error — every failure mode returns the same envelope, with an HTTP status matching the code:**

```json
{ "error": { "code": "INVALID_URL", "message": "..." } }
```

| Code | HTTP status | Meaning |
|---|---|---|
| `INVALID_URL` | 400 | Missing `url` param, or it's not a `linkedin.com/in/...` profile URL |
| `PROFILE_NOT_FOUND` | 404 | No profile at that URL (LinkedIn doesn't cleanly distinguish this from a private profile — see limitations) |
| `PROFILE_PRIVATE` | 403 | Reserved in the contract; not currently distinguishable from `PROFILE_NOT_FOUND` in practice — see limitations |
| `SESSION_EXPIRED` | 401 | No usable session: the shared session expired, or a bearer token was unrecognized/invalid |
| `LOGIN_CHALLENGE` | 401 | Reserved for the automated-login path (Phase 2); never returned by this build |
| `LINKEDIN_RATE_LIMITED` | 502 | LinkedIn itself rate-limited the session |
| `RATE_LIMITED` | 429 | This API's own per-IP rate limit was hit |
| `INTERNAL_ERROR` | 500 | Unexpected failure (misconfiguration, unexpected LinkedIn response shape, etc.) |
| `INVALID_SESSION_DATA` | 400 | `POST /api/sessions`(`/default`) body is missing/malformed `liAt` or `jsessionid` |
| `UNAUTHORIZED` | 401 | `POST /api/sessions/default` called with a missing or wrong `X-Admin-Secret` |

## Project structure

```
api/                 Vercel serverless functions
  profile.ts           GET /api/profile
  health.ts            GET /api/health
  sessions.ts           POST /api/sessions (bring-your-own-session)
  sessions/default.ts    POST /api/sessions/default (admin-only refresh)
src/linkedin/        session.ts, sessionResolver.ts, voyagerClient.ts, identifiers.ts, profileFetcher.ts, profileParser.ts
src/sessions/        sessionStore.ts — Redis-backed session storage + the token/default/env priority logic
src/rateLimit/       Upstash sliding-window limiter
src/cache/           shared Redis client
src/types/           the ProfileResponse/ApiErrorResponse contract, and loose raw-JSON types
src/utils/           error-code -> HTTP status mapping, client-IP extraction, constant-time admin-secret check
tests/               identifiers.test.ts, profileParser.test.ts, ip.test.ts, sessionSource.test.ts (pure-function TDD seams)
scripts/             standalone verification against live LinkedIn/Redis (see Setup above)
tests/fixtures/      real captured (partially sanitized) LinkedIn responses used as test fixtures
```

## Known limitations

- **The manual session expires often — this is still the single biggest limitation, even with Phase 3.** During development, the captured session was observed expiring multiple times within a single day of testing — sometimes within minutes of a fresh capture — likely because rapid automated requests get flagged faster than normal human browsing. Phase 3 makes *recovering* from this fast (one `POST /api/sessions/default` call, no redeploy, or a visitor bringing their own session), but the session still dies just as often as before; nothing here makes LinkedIn stop invalidating it. Automated re-login (Phase 2) was explicitly scoped out to keep the project's time budget on the actual reverse-engineering work.
- **Session values sit in Redis without application-level encryption.** Upstash encrypts at rest on their own infrastructure, but this project doesn't add its own encryption layer on top — anyone holding `UPSTASH_REDIS_REST_TOKEN` could read stored sessions (both the shared default and any visitor-submitted ones) in plaintext. Stated plainly here rather than glossed over, same spirit as the ToS disclosure below.
- **A bearer token is a bare credential with no recovery flow.** There's no account system behind `POST /api/sessions` — losing a token just means submitting your session again for a new one. Anyone holding a token can use it to make requests against the session it points to.
- **Private vs. not-found profiles aren't distinguished.** No private-profile response was ever captured during development to confirm LinkedIn's exact behavior, so both currently surface as `PROFILE_NOT_FOUND`. The `PROFILE_PRIVATE` code exists in the contract but isn't reliably triggered.
- **LinkedIn's Voyager API is undocumented and can drift.** The exact `decorationId` and field shapes were reverse-engineered from live traffic and are not guaranteed stable — LinkedIn could change them at any time without notice. Raw-fetch and parsing logic are kept strictly separated so that drift only breaks the parser, not the whole pipeline.
- **No guaranteed contact info.** Email and phone are not returned — LinkedIn restricts these heavily even for authenticated viewers, so they're not a reliable field to promise.
- **Skill endorsement counts aren't available.** LinkedIn's current dash-endpoint response doesn't include them, despite the field existing in the response contract as optional.
- **Rate limiting fails open if Upstash isn't configured**, by design (see Setup) — don't deploy without it configured if you actually want the protection.
- **This violates LinkedIn's User Agreement** — see the disclosure at the top of this README.
