# LinkedIn Profile API

A hosted API that takes a LinkedIn profile URL and returns structured JSON — name, headline, location, about, experience, education, skills, certifications, languages, and profile images.

**Live:** https://linkedin-scrapper-taupe.vercel.app
**Example:** `GET /api/profile?url=https://www.linkedin.com/in/someone/`

This is a submission for Tross's hiring challenge. Per the challenge's explicit clarification, it does **not** use any browser automation (no Puppeteer/Playwright/Selenium) anywhere in the request path — it reverse-engineers and calls LinkedIn's internal "Voyager" API directly over HTTP, the same way LinkedIn's own web client does.

## ⚠️ Legal / risk disclosure

This technique violates LinkedIn's User Agreement. The LinkedIn account whose session powers this API is at real risk of restriction or ban. This is a hiring-challenge submission built to demonstrate the reverse-engineering and system-design work involved — not a product intended for production traffic against real users' accounts. Anyone running this themselves should understand and accept that risk for their own account.

## How it works (approach)

- **Auth strategy — manual session only (no automated login).** The backend reads a LinkedIn session (`li_at` cookie + paired `JSESSIONID` CSRF token) from environment variables, captured once by a human logging into LinkedIn in a real browser. There is no login flow in the deployed code — nothing resembling a bot logging into LinkedIn ever runs at request time. If the session is rejected, the API returns `SESSION_EXPIRED`; recovery is manual (re-capture the cookie, update the env var, redeploy). This was a deliberate scope decision: it trades away the riskiest, most bot-detection-prone part of a project like this (automated login) in favor of putting the available time into the actual profile-fetching and parsing work, which is the part the challenge is actually testing.
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

This session **will expire** — see [Known Limitations](#known-limitations) below; this is the single biggest practical limitation of the whole project.

### 3. Set up rate limiting (Upstash Redis)

1. Create a free Redis database at [console.upstash.com](https://console.upstash.com).
2. On its dashboard, find the **REST API** section (not the Redis-protocol connection string) and copy the REST URL and REST token.
3. Add them to `.env`:
   ```
   UPSTASH_REDIS_REST_URL=<your REST URL>
   UPSTASH_REDIS_REST_TOKEN=<your REST token>
   ```

If these are left unset, rate limiting **fails open** (a warning is logged and requests proceed unlimited) rather than the whole API refusing to start — useful for local dev, but you should configure it for any real deployment.

### 4. Run tests / type-check

```bash
npm run typecheck
npm test
```

### 5. Verify against the real LinkedIn API

Vercel's local dev server (`vercel dev`) requires an interactive browser login, so the pipeline is instead verified with standalone scripts that call the same code directly:

```bash
node --env-file=.env --import tsx scripts/verify-session.ts        # session -> raw HTTP call
node --env-file=.env --import tsx scripts/test-fetch-profile.ts <linkedin-profile-url>
node --env-file=.env --import tsx scripts/test-endpoint.ts <linkedin-profile-url>   # full api/profile.ts pipeline
node --env-file=.env --import tsx scripts/test-rate-limit.ts       # hammers the limiter against real Redis
```

### 6. Deploy your own copy

```bash
npx vercel login
npx vercel link
npx vercel env add LI_AT_COOKIE production
npx vercel env add LI_JSESSIONID production
npx vercel env add UPSTASH_REDIS_REST_URL production
npx vercel env add UPSTASH_REDIS_REST_TOKEN production
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

**Error — every failure mode returns the same envelope, with an HTTP status matching the code:**

```json
{ "error": { "code": "INVALID_URL", "message": "..." } }
```

| Code | HTTP status | Meaning |
|---|---|---|
| `INVALID_URL` | 400 | Missing `url` param, or it's not a `linkedin.com/in/...` profile URL |
| `PROFILE_NOT_FOUND` | 404 | No profile at that URL (LinkedIn doesn't cleanly distinguish this from a private profile — see limitations) |
| `PROFILE_PRIVATE` | 403 | Reserved in the contract; not currently distinguishable from `PROFILE_NOT_FOUND` in practice — see limitations |
| `SESSION_EXPIRED` | 401 | The manual session needs to be re-captured and redeployed |
| `LOGIN_CHALLENGE` | 401 | Reserved for the automated-login path (Phase 2); never returned by this Phase 1 build |
| `LINKEDIN_RATE_LIMITED` | 502 | LinkedIn itself rate-limited the session |
| `RATE_LIMITED` | 429 | This API's own per-IP rate limit was hit |
| `INTERNAL_ERROR` | 500 | Unexpected failure (misconfiguration, unexpected LinkedIn response shape, etc.) |

## Project structure

```
api/            Vercel serverless functions (profile.ts, health.ts)
src/linkedin/   session.ts, voyagerClient.ts, identifiers.ts, profileFetcher.ts, profileParser.ts
src/rateLimit/  Upstash sliding-window limiter
src/cache/      shared Redis client
src/types/      the ProfileResponse/ApiErrorResponse contract, and loose raw-JSON types
src/utils/      error-code -> HTTP status mapping, client-IP extraction
tests/          identifiers.test.ts, profileParser.test.ts, ip.test.ts (pure-function TDD seams)
scripts/        standalone verification against live LinkedIn/Redis (see Setup above)
tests/fixtures/ real captured (partially sanitized) LinkedIn responses used as test fixtures
```

## Known limitations

- **The manual session expires often, with no automated recovery.** This is the single biggest limitation. During development, the captured session was observed expiring multiple times within a single day of testing — sometimes within minutes of a fresh capture — likely because rapid automated requests get flagged faster than normal human browsing. Recovery is entirely manual: re-capture `li_at`/`JSESSIONID` from a browser, update the env var, redeploy. Automated re-login (Phase 2) was explicitly scoped out to keep the project's time budget on the actual reverse-engineering work.
- **Private vs. not-found profiles aren't distinguished.** No private-profile response was ever captured during development to confirm LinkedIn's exact behavior, so both currently surface as `PROFILE_NOT_FOUND`. The `PROFILE_PRIVATE` code exists in the contract but isn't reliably triggered.
- **LinkedIn's Voyager API is undocumented and can drift.** The exact `decorationId` and field shapes were reverse-engineered from live traffic and are not guaranteed stable — LinkedIn could change them at any time without notice. Raw-fetch and parsing logic are kept strictly separated so that drift only breaks the parser, not the whole pipeline.
- **No guaranteed contact info.** Email and phone are not returned — LinkedIn restricts these heavily even for authenticated viewers, so they're not a reliable field to promise.
- **Skill endorsement counts aren't available.** LinkedIn's current dash-endpoint response doesn't include them, despite the field existing in the response contract as optional.
- **Rate limiting fails open if Upstash isn't configured**, by design (see Setup) — don't deploy without it configured if you actually want the protection.
- **This violates LinkedIn's User Agreement** — see the disclosure at the top of this README.
