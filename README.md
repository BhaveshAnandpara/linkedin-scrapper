# LinkedIn Profile API

A hosted API that turns a LinkedIn profile URL into structured JSON: name, headline, location, about, experience, education, skills, certifications, languages, and profile images.

**Live:** https://linkedin-scrapper-taupe.vercel.app

This is a submission for Tross's hiring challenge. The hiring team explicitly ruled out browser automation anywhere in the request path, so this API reverse-engineers LinkedIn's internal "Voyager" API and calls it directly over HTTP, the same way LinkedIn's own web client does.

> [!WARNING]
> This technique violates LinkedIn's User Agreement. The LinkedIn account whose session powers this API is at real risk of restriction or ban. This is a hiring-challenge submission meant to demonstrate the reverse-engineering and system-design work, not a product for production traffic against real users' accounts. Anyone running this themselves should accept that risk for their own account.

## Use it now (no setup required)

Anyone can call the live API directly, no login and no account needed:

```bash
curl "https://linkedin-scrapper-taupe.vercel.app/api/profile?url=https://www.linkedin.com/in/someone/"
```

Swap the `url` value for any LinkedIn profile URL and you'll get back JSON like this:

```json
{
  "name": "Jane Doe",
  "headline": "Software Engineer",
  "location": "San Francisco, California, United States",
  "experience": [ "..." ],
  "education": [ "..." ],
  "skills": [ "..." ]
}
```

The full response shape is documented under [API reference](#api-reference) below.

If you get an error instead, the most common cause is that the shared session behind the API has expired. That happens occasionally, see [Known limitations](#known-limitations).

### Bring your own LinkedIn session (optional)

Want your requests to run on your own session instead of the shared one, or is the shared one down? You can plug in your own.

1. Log into LinkedIn in a normal browser.
2. Open developer tools (`F12`), then go to **Application** (Chrome) or **Storage** (Firefox) → **Cookies** → `https://www.linkedin.com`.
3. Copy the value of the `li_at` cookie, then the `JSESSIONID` cookie.
4. Submit them to get a token:
   ```bash
   curl -X POST https://linkedin-scrapper-taupe.vercel.app/api/sessions \
     -H "Content-Type: application/json" \
     -d '{"liAt": "<your li_at>", "jsessionid": "<your JSESSIONID>"}'
   ```
   This returns `{ "token": "..." }`.
5. Use that token on every profile request:
   ```bash
   curl -H "Authorization: Bearer <your token>" \
     "https://linkedin-scrapper-taupe.vercel.app/api/profile?url=https://www.linkedin.com/in/someone/"
   ```

Treat `li_at` and `JSESSIONID` like a password: anyone who has them can act as your LinkedIn account through this API. Tokens expire after 7 days; if yours stops working, repeat these steps for a new one.

## Run your own copy

### Prerequisites

- Node.js 20+
- A LinkedIn account, for capturing a session (stays local, in your own `.env`)
- A free [Upstash](https://console.upstash.com) Redis database, for rate limiting
- A [Vercel](https://vercel.com) account, if you want to deploy

### 1. Clone and install

```bash
git clone https://github.com/BhaveshAnandpara/linkedin-scrapper.git
cd linkedin-scrapper
npm install
```

### 2. Capture a LinkedIn session

Same steps as above: log in, open developer tools, copy `li_at` and `JSESSIONID`. Copy `.env.example` to `.env` and add them:

```
LI_AT_COOKIE=<your li_at value>
LI_JSESSIONID=<your JSESSIONID value>
```

This session will expire eventually. As of Phase 3, refreshing it doesn't require a redeploy, see [`POST /api/sessions/default`](#post-apisessionsdefault) below.

### 3. Set up rate limiting

Create a free Redis database at [console.upstash.com](https://console.upstash.com). On its dashboard, find the **REST API** section (not the Redis-protocol connection string) and copy the REST URL and token into `.env`:

```
UPSTASH_REDIS_REST_URL=<your REST URL>
UPSTASH_REDIS_REST_TOKEN=<your REST token>
```

> [!NOTE]
> Leaving these unset doesn't stop the API from starting: rate limiting just fails open, so requests proceed unlimited. Fine for local development, but configure it for any real deployment.

### 4. Set an admin secret

Generate a random value and add it to `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```
ADMIN_SECRET=<the generated value>
```

This guards `POST /api/sessions/default`, which refreshes the session behind unauthenticated requests without a redeploy.

### 5. Run tests and type-check

```bash
npm run typecheck
npm test
```

### 6. Verify against the real LinkedIn API

`vercel dev` needs an interactive browser login this environment can't provide, so the pipeline is verified with standalone scripts that call the same code directly:

```bash
node --env-file=.env --import tsx scripts/verify-session.ts
node --env-file=.env --import tsx scripts/test-fetch-profile.ts <linkedin-profile-url>
node --env-file=.env --import tsx scripts/test-endpoint.ts <linkedin-profile-url>
node --env-file=.env --import tsx scripts/test-rate-limit.ts
node --env-file=.env --import tsx scripts/test-sessions.ts <linkedin-profile-url>
```

### 7. Deploy

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

## API reference

### `GET /api/health`

A liveness check, no LinkedIn call.

```json
{ "status": "ok" }
```

### `GET /api/profile?url=<linkedin-profile-url>`

Returns the profile's data. Add `Authorization: Bearer <token>` to run the request on your own session instead of the shared one (see [Bring your own LinkedIn session](#bring-your-own-linkedin-session-optional)).

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

`meta.partial` is `true` when a section runs longer than what LinkedIn returned in one call, for example only the first 20 of 56 skills. `meta.limitations` lists which sections got cut short. Fields LinkedIn didn't return are left out rather than causing an error.

### `POST /api/sessions`

Submit your own LinkedIn session, get a bearer token back. Session values go in the request body only, never the URL: a URL ends up in access logs, browser history, and `Referer` headers in a way a request body doesn't.

```bash
curl -X POST https://linkedin-scrapper-taupe.vercel.app/api/sessions \
  -H "Content-Type: application/json" \
  -d '{"liAt": "<your li_at>", "jsessionid": "<your JSESSIONID>"}'
```

Returns `{ "token": "..." }`. Tokens last 7 days. There's no account system: if you lose a token, submit your session again for a new one. An unrecognized token returns `401 SESSION_EXPIRED` rather than silently falling back to the shared session.

### `POST /api/sessions/default`

Admin only, guarded by an `X-Admin-Secret` header. Updates the session that powers every request made without a bearer token.

```bash
curl -X POST https://linkedin-scrapper-taupe.vercel.app/api/sessions/default \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: <your ADMIN_SECRET>" \
  -d '{"liAt": "<fresh li_at>", "jsessionid": "<fresh JSESSIONID>"}'
```

Returns `{ "ok": true }`.

### Errors

Every failure returns the same shape, with an HTTP status matching the code:

```json
{ "error": { "code": "INVALID_URL", "message": "..." } }
```

| Code | Status | Meaning |
|---|---|---|
| `INVALID_URL` | 400 | Missing `url` param, or it isn't a `linkedin.com/in/...` URL |
| `PROFILE_NOT_FOUND` | 404 | No profile at that URL; LinkedIn doesn't distinguish this from a private profile |
| `PROFILE_PRIVATE` | 403 | Reserved; not currently distinguishable from `PROFILE_NOT_FOUND` in practice |
| `SESSION_EXPIRED` | 401 | No usable session: the shared session expired, or a bearer token was unrecognized |
| `LOGIN_CHALLENGE` | 401 | Reserved for an automated-login path that was never built |
| `LINKEDIN_RATE_LIMITED` | 502 | LinkedIn rate-limited the session |
| `RATE_LIMITED` | 429 | This API's own per-IP rate limit was hit |
| `INTERNAL_ERROR` | 500 | Unexpected failure |
| `INVALID_SESSION_DATA` | 400 | `POST /api/sessions` (or `/default`) body is missing `liAt` or `jsessionid` |
| `UNAUTHORIZED` | 401 | `POST /api/sessions/default` called with a missing or wrong `X-Admin-Secret` |

## How it works

The backend authenticates with a session cookie captured once from a real, manual LinkedIn login, not by automating the login itself. That trade removes the riskiest part of a project like this (LinkedIn's bot detection catching an automated login) and puts the time into what the challenge is actually testing: reverse-engineering the profile endpoints correctly.

A session reaches the API three ways, checked in order: a visitor's own bearer token, a shared session stored in Redis that the account owner refreshes through `POST /api/sessions/default`, or the original environment variables as a last resort if Redis is unreachable.

LinkedIn's current web frontend renders profiles through a server-driven UI pipeline that doesn't expose data as clean JSON, and the older REST-style endpoints are gone (`410 Gone`). What still works is a "dash" endpoint:

```
GET https://www.linkedin.com/voyager/api/identity/dash/profiles
    ?q=memberIdentity&memberIdentity={publicIdentifier}
    &decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-93
```

It returns the full profile inline: name, headline, summary, positions, education, skills, certifications, languages, images, keyed off the profile slug.

Fetching the raw data and parsing it into the API's response shape are separate steps. LinkedIn's internal API is undocumented and can change without notice, so keeping the two apart means a shape change only breaks the parser, not the rest of the pipeline.

Testing follows the same split. `profileParser.ts` and `identifiers.ts` are pure functions, tested with real captured fixtures. Anything that depends on a live LinkedIn session or a live Redis instance is verified with standalone scripts instead, since mocking either would test the mock rather than the real thing.

For diagrams of the full request flow and module boundaries, see [ARCHITECTURE.md](ARCHITECTURE.md). For the full design history, see [docs/specs/linkedin-profile-api.md](docs/specs/linkedin-profile-api.md).

**Built:** manual-session auth (Phase 1), bring-your-own-session (Phase 3). **Not built:** automated login (Phase 2) was scoped as a stretch goal and left out on purpose; the manual-session approach above is the complete submission.

## Project structure

```
api/                 Vercel serverless functions
  profile.ts            GET /api/profile
  health.ts             GET /api/health
  sessions.ts            POST /api/sessions
  sessions/default.ts     POST /api/sessions/default
src/linkedin/        session.ts, sessionResolver.ts, voyagerClient.ts, identifiers.ts, profileFetcher.ts, profileParser.ts
src/sessions/        sessionStore.ts, Redis-backed session storage and the token/default/env priority logic
src/rateLimit/       Upstash sliding-window limiter
src/cache/           shared Redis client
src/types/           the response contract, and loose raw-JSON types
src/utils/           error mapping, client-IP extraction, constant-time admin-secret check
tests/               pure-function tests (identifiers, parser, IP, session source)
scripts/             standalone verification against live LinkedIn and Redis
tests/fixtures/      real captured (partially sanitized) LinkedIn responses used in tests
```

## Known limitations

The manual session expires often, and this is still the main limitation even with Phase 3. During development, the captured session expired several times in a single day of testing, sometimes within minutes of a fresh capture, most likely because rapid automated requests get flagged faster than normal browsing does. Phase 3 makes recovering from this fast, one API call, no redeploy, but the session dies just as often as before. Automated re-login (Phase 2) was left out to keep the project's time on the actual reverse-engineering work.

Session values sit in Redis without extra encryption on top of Upstash's own at-rest encryption. Anyone holding `UPSTASH_REDIS_REST_TOKEN` could read stored sessions, both the shared one and any submitted by visitors.

A bearer token has no recovery flow. There's no account system behind `POST /api/sessions`; losing a token means submitting your session again for a new one, and anyone holding a token can use it.

Private and not-found profiles aren't distinguished. No private-profile response was captured during development, so both currently return `PROFILE_NOT_FOUND`.

LinkedIn's Voyager API is undocumented and can change. The `decorationId` and field shapes here came from reverse-engineering live traffic, not from any official documentation.

Email and phone aren't returned. LinkedIn restricts contact info heavily even for authenticated viewers.

Skill endorsement counts aren't available in the current API response, despite the field existing as optional in the contract.

Rate limiting fails open if Upstash isn't configured. Don't deploy without it configured if you want the protection.

This violates LinkedIn's User Agreement, see the warning at the top of this README.
