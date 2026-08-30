# LinkedIn Profile API — Specification

> **Status (2026-08-30):** Phase 1 below is complete, deployed, and verified live at https://linkedin-scrapper-taupe.vercel.app. Phase 2 (automated login) remains out of scope and unbuilt. Phase 3 (Bring-Your-Own-Session) was added below the same day as a new stretch goal, worked out via the brainstorming skill after real friction with Phase 1's single shared session — it is a separate concern from Phase 2 and does not touch login automation.

## Problem Statement

I need to submit a working solution to Tross's hiring challenge by 2026-08-31: a hosted API that accepts a LinkedIn profile URL and returns structured profile data as JSON. The hiring team explicitly clarified that browser automation is disallowed anywhere in the request-serving path — the solution must reverse-engineer and call LinkedIn's internal endpoints directly over HTTP. I have no existing codebase to build on, a hard deadline, and no reliable way to safely automate LinkedIn's login flow without risking my own account being checkpointed right when I need it working for a demo.

## Solution

Build a Node.js/TypeScript API, deployed on Vercel, that reverse-engineers LinkedIn's internal "Voyager" API and calls it directly per request. Authentication is solved by using a session cookie captured once from a real, manual LinkedIn login — not by automating the login itself. This removes the single highest-risk, most fragile piece of the project (LinkedIn's bot-detection on programmatic login) from the critical path, and puts the available build time into the part that actually demonstrates the challenge's intent: correctly reverse-engineering the profile data endpoints. Automated login is treated as an explicit stretch goal, additive on top of the working manual-session system, only attempted once the core is deployed and functioning.

This mirrors how PhantomBuster's own LinkedIn Profile Scraper works in production (manually-captured session cookie + direct API calls, no page visits) — a real-world precedent that this pattern is both viable and considered acceptable "own credentials" usage under the challenge's rules.

## User Stories

1. As the challenge submitter, I want the API to accept any well-formed `linkedin.com/in/{slug}` URL, so that it satisfies the "accept a LinkedIn profile URL as input" requirement.
2. As the challenge submitter, I want the API to reject non-LinkedIn or malformed URLs with a clear `400` error, so that misuse fails fast and predictably.
3. As an API caller, I want the response to include the profile's name, so that I can identify who the data belongs to.
4. As an API caller, I want the response to include headline, location, and about text when present, so that I get the profile's summary information.
5. As an API caller, I want the response to include a structured list of experience entries (title, company, dates, description), so that I can see the person's work history.
6. As an API caller, I want the response to include a structured list of education entries (school, degree, field of study, dates), so that I can see the person's academic background.
7. As an API caller, I want the response to include a list of skills, so that I can see what the profile claims expertise in.
8. As an API caller, I want the response to include certifications when present, so that I get credential information.
9. As an API caller, I want the response to include languages when present, so that I get language proficiency information.
10. As an API caller, I want the response to include the profile image URL(s) when available, so that I can display the person's photo.
11. As an API caller, I want a clear, typed error response (not a raw LinkedIn payload or stack trace) when something goes wrong, so that failures are safe and easy to handle programmatically.
12. As an API caller, I want to be rate-limited rather than silently failing or hanging, so that I understand the API is protecting itself.
13. As the challenge submitter, I want the LinkedIn session used by the backend to come from a session I capture manually once, so that I avoid the high risk of an automated login attempt getting checkpointed right before the deadline.
14. As the challenge submitter, I want a documented way to refresh that session (update an env var, redeploy) when it eventually expires, so that the deployed API can be kept alive through the demo/review period without a rebuild.
15. As the challenge submitter, I want the backend's own LinkedIn account protected from abuse by the public endpoint, so that a stranger hammering the API can't get my account flagged or banned.
16. As the challenge submitter, I want no LinkedIn credentials, cookies, or other secrets ever committed to the repo, so that the public GitHub submission is safe to share.
17. As the challenge submitter, I want the raw-fetch logic and the response-parsing logic kept as separate layers, so that when LinkedIn changes its internal API shape, only one layer needs to change.
18. As the challenge submitter, I want partial data (some sections missing/empty) to still return a usable `200` response rather than a hard failure, so that the API degrades gracefully on sparse or privacy-restricted profiles.
19. As a hiring reviewer, I want a README with setup instructions, API documentation, the reverse-engineering approach, and known limitations, so that I can evaluate the submission without needing to read all the source code first.
20. As a hiring reviewer, I want the README to be honest about the legal/account risk of this technique, so that I can trust the rest of the submission's technical claims.
21. As the challenge submitter, I want the option to layer automated LinkedIn login on top of the working manual-session system later, so that the project can improve without risking the core deliverable if that stretch work runs out of time.

## Implementation Decisions

**Runtime & platform:** Node.js with TypeScript, deployed as Vercel serverless functions. Vercel functions are stateless between invocations (no persistent memory/disk), which is why session/rate-limit state that must survive across requests lives in an external store rather than in-process memory.

**LinkedIn access module:** A raw HTTP client responsible only for talking to LinkedIn's internal Voyager API — building the correct headers/cookies for a request and returning the raw response or a typed transport-level error. It knows nothing about our own response shape.

**Session strategy (Phase 1 — required):** The backend reads a LinkedIn session (the `li_at` cookie plus the paired session-ID value LinkedIn requires as a CSRF token) from environment variables, captured once via a real manual login in a browser, outside the deployed system. No login flow runs at request time. If LinkedIn rejects the session, the API returns a distinct `SESSION_EXPIRED` error rather than attempting any recovery — recovery in Phase 1 is a manual, out-of-band action (re-capture the cookie, update the env var, redeploy).

**Session strategy (Phase 2 — stretch, out of scope for this spec):** See "Out of Scope."

**Identifier resolution:** A pure function maps an incoming `linkedin.com/in/{slug}` URL to the identifier LinkedIn's profile endpoint expects, and rejects anything that doesn't match that shape.

**Profile fetch module:** Given a resolved identifier and a valid session, calls LinkedIn's profile endpoint and returns the raw JSON (or a typed error for not-found/private/upstream-failure cases). Contains no knowledge of our own response schema.

**Response parsing module:** A pure function that transforms LinkedIn's raw JSON into our own response shape. This is the module most exposed to LinkedIn's undocumented, drifting internal API shape, which is exactly why it's isolated from the fetch and auth layers — a shape change should only ever require changing this one module.

**Response schema (API contract) — the decision this most needs to be precise about:**

```typescript
interface ProfileResponse {
  requestedUrl: string;
  publicIdentifier: string;
  name: string;
  headline?: string;
  location?: string;
  about?: string;
  profileImage?: { url: string; width?: number; height?: number };
  profileImages?: { url: string; width?: number; height?: number }[];
  experience: {
    title: string;
    company: string;
    location?: string;
    startDate?: { month?: number; year: number };
    endDate?: { month?: number; year: number } | null; // null = current role
    isCurrent: boolean;
    description?: string;
  }[];
  education: {
    school: string;
    degree?: string;
    fieldOfStudy?: string;
    startYear?: number;
    endYear?: number;
    description?: string;
  }[];
  skills: { name: string; endorsementCount?: number }[];
  certifications: {
    name: string;
    issuingOrganization?: string;
    issueDate?: { month?: number; year: number };
    expirationDate?: { month?: number; year: number } | null;
    credentialUrl?: string;
  }[];
  languages: { name: string; proficiency?: string }[];
  meta: {
    fetchedAt: string;   // ISO timestamp
    partial: boolean;    // true if any section was unavailable
    limitations?: string[];
  };
}

interface ApiErrorResponse {
  error: {
    code:
      | "INVALID_URL" | "PROFILE_NOT_FOUND" | "PROFILE_PRIVATE"
      | "SESSION_EXPIRED" | "LOGIN_CHALLENGE" | "LINKEDIN_RATE_LIMITED"
      | "RATE_LIMITED" | "INTERNAL_ERROR";
    message: string;
  };
}
```

**Rate limiting & abuse protection:** The public endpoint requires no API key, but every request is rate-limited per client IP via an external, Redis-backed limiter (necessary because Vercel functions can't hold in-process rate-limit counters reliably across invocations). The rate-limit check happens before any LinkedIn call is attempted, so LinkedIn is never touched on a rejected request.

**Caching (optional, time-permitting):** Successful profile responses may be cached for a short TTL, keyed by identifier, to avoid repeat LinkedIn calls for the same profile in quick succession. This is a nice-to-have, not required for the core deliverable.

**Secrets handling:** All credentials/session values are read from environment variables only, documented by name (not value) in an example env file. No `.env`, captured cookies, or other secret material is ever committed.

## Testing Decisions

A good test here exercises external behavior only — given this input, is that the correct output — never internal implementation details of how a module gets there, since LinkedIn's undocumented internals are exactly the part expected to drift.

- **Primary, highest-value seam: the response-parsing module.** Tested with real captured LinkedIn JSON fixtures (obtained during manual recon of the live API) as input, asserting the correct `ProfileResponse` shape as output — including profiles with sparse/missing sections, to confirm graceful partial results rather than crashes.
- **Secondary seam: identifier/URL resolution.** A small, pure function; tested directly with valid and invalid URL shapes.
- **Everything else is deliberately not covered by an automated test seam.** Session handling, the live profile fetch, and rate limiting all depend on real external, non-deterministic state (a live LinkedIn session, LinkedIn's actual current behavior) that can't be meaningfully mocked without losing signal about whether the real thing works. These are instead verified through standalone verification scripts run against the real LinkedIn API, and an end-to-end smoke test against the deployed URL — a deliberate choice, not a coverage gap.
- **Prior art:** none — this is a greenfield repo, so this spec's testing approach sets the first precedent for the project.

## Phase 3: Bring-Your-Own-Session (stretch goal, added 2026-08-30)

### Problem Statement

Phase 1's single shared LinkedIn session has two real problems, both discovered through actually operating the deployed API, not hypothetical: (1) the session dies far faster than expected under normal development/testing load — observed expiring multiple times in one day, sometimes within minutes of a fresh capture — and recovery requires a manual redeploy each time; (2) a hiring-team reviewer testing the live API has no way to supply their own LinkedIn session, and no way to refresh the shared one, because they don't have access to this project's Vercel deployment or its environment variables. If the shared session happens to be dead when a reviewer tests the link, they get a hard failure with nothing they can do about it.

### Solution

Let a session live in Redis instead of only in a Vercel env var, addressable in two ways: a reserved slot for the shared/default session (refreshable by the account owner via an admin-guarded endpoint, no redeploy needed), and a per-visitor slot addressable by a bearer token (so a reviewer can submit their own captured session and have their own requests run on it, independent of the shared one). This changes *where* a session comes from and *who* it belongs to — it does not change *how* a session is obtained. No login automation, no browser automation; a human still manually captures `li_at`/`JSESSIONID` from their own real browser login, exactly as in Phase 1. Phase 3 is unrelated to Phase 2 and does not depend on it.

### User Stories

22. As the challenge submitter, I want to refresh my own backend LinkedIn session without a Vercel redeploy, so that recovering from the session dying (which happens often) takes seconds instead of a full deploy cycle.
23. As a hiring reviewer, I want to be able to submit my own captured LinkedIn session and get a token back, so that I can test the API on my own session if the shared one happens to be down.
24. As a hiring reviewer holding a token, I want to pass it on my `/api/profile` requests and have them run on my own session, so that my testing doesn't depend on the submitter's account being healthy.
25. As an API caller with no token, I want requests to keep working exactly as they do today (falling back to the shared session), so that Phase 3 doesn't change the experience for anyone who doesn't opt in.
26. As the challenge submitter, I want the admin-only refresh endpoint protected by a secret distinct from any visitor-facing credential, so that only I can overwrite the session powering all unauthenticated public traffic.
27. As the challenge submitter, I want session values to never appear in a URL (query params, logs, browser history, `Referer` headers), so that capturing this data doesn't recreate the exact leak risk this project already had to react to once (a raw cookie pasted into chat).
28. As the challenge submitter, I want the plaintext-in-Redis limitation stated plainly in the README, so that anyone evaluating this is told the honest risk rather than discovering it themselves.
29. As the challenge submitter, I want the system to keep working (falling back to env vars) if Redis is ever unreachable, so that Phase 3 is additive and can't take down what Phase 1 already had working.

### Implementation Decisions

**Session store:** A new module owns reading/writing LinkedIn sessions in the existing Upstash Redis instance (the same one already provisioned for rate limiting). Two kinds of entries: visitor sessions, keyed by an opaque, cryptographically random, unguessable token; and one reserved key holding the shared/default session. Entries carry a TTL.

**Bring-your-own-session endpoint:** A public endpoint accepts a visitor's session (`li_at`, `JSESSIONID`, optionally a user agent) in the **request body** — never as URL query params, since a URL leaks into server/CDN access logs, browser history, and third-party `Referer` headers in a way a body doesn't. On success it stores the session under a freshly generated token and returns that token. There is no account system and no token-recovery flow; losing a token just means submitting the session again for a new one.

**Admin default-session refresh endpoint:** Same body shape, but requires a secret (distinct from any visitor-facing value) sent as a header and compared in constant time, and writes to the reserved default key instead of minting a token. This is the account owner's new way to refresh their own session — replacing "update the env var and redeploy" with one authenticated request.

**Session resolution order, for every `/api/profile` request:** (1) if the request carries a bearer token, resolve that visitor's stored session; (2) otherwise, resolve the shared default session from the store; (3) if neither is available (e.g. the store is unreachable, or the default was never set), fall back to the original environment-variable-based session from Phase 1. This ordering is itself the one pure, testable decision this phase introduces — see Testing Decisions.

**Error contract additions:** an unresolvable or unrecognized bearer token maps to the existing `SESSION_EXPIRED` code — the caller-facing meaning is identical ("no usable session"). A malformed bring-your-own-session submission (missing required fields) is a new failure mode not covered by any existing code, and needs its own addition to the shared `ApiErrorCode` union:

```typescript
type ApiErrorCode =
  | "INVALID_URL" | "PROFILE_NOT_FOUND" | "PROFILE_PRIVATE"
  | "SESSION_EXPIRED" | "LOGIN_CHALLENGE" | "LINKEDIN_RATE_LIMITED"
  | "RATE_LIMITED" | "INTERNAL_ERROR"
  | "INVALID_SESSION_DATA"; // new: malformed bring-your-own-session submission
```

The admin endpoint rejecting a wrong/missing secret returns a generic unauthorized response that doesn't hint whether the supplied value was close to correct.

**Security decisions (treated as first-class, not an afterthought — this was explicitly interrogated during brainstorming):** session values and bearer tokens travel only in request bodies and the `Authorization` header, never in a URL. Tokens are generated with a cryptographically secure random source. No code path in this feature logs request bodies or session values. The admin secret is compared in constant time. The one accepted, plainly-documented limitation: session values sit in Redis without any application-level encryption on top of Upstash's own at-rest encryption, so anyone holding the Redis access token could read them.

### Testing Decisions

Same philosophy as Phase 1: test external behavior at the highest-value seam, verify everything touching live external state with standalone scripts rather than mocks that would only prove the mock works.

- **The one pure seam: session-source resolution.** The priority-order decision (token vs. default vs. env-var fallback vs. none available) is a pure function of a small number of inputs (is a token present, does a default exist, does an env-var fallback exist) and is fully enumerable — every combination can be asserted directly, the same way `identifiers.ts` and `errors.ts` are tested today.
- **Token generation is not a separate seam.** There is nothing meaningful to assert about a random token beyond "it is a string of the expected shape," which isn't worth a dedicated test.
- **Everything touching real Redis or the two new endpoints end-to-end is verified via a new standalone script**, exercising: a valid bring-your-own-session submission returns a usable token; that token works on `/api/profile`; a malformed submission returns the new error code; a wrong admin secret is rejected. Same rationale and prior art as `scripts/verify-session.ts` and `scripts/test-fetch-profile.ts` from Phase 1.

## Out of Scope

- **Automated LinkedIn login (Phase 2).** Explicitly deferred. If time remains after the Phase 1 system above is built, deployed, and verified working end-to-end, automated username/password login (with session self-healing on expiry) may be added as a separate, additive piece of work — its own spec/plan if pursued, not covered by this document. Unrelated to and independent of Phase 3.
- **Any browser automation**, at any point in the request-serving path — disallowed by the challenge's explicit clarification. This includes Phase 3: nothing in Phase 3 automates a LinkedIn login or drives a browser; it only changes where an already-manually-captured session is stored and how a request selects one.
- **An API key / authenticated access model** for our own public endpoint — deliberately left open (rate-limiting is the only protection) so reviewers can test it without needing credentials from us. Phase 3's bearer tokens are opt-in, not a requirement to use the API.
- **The actual browser extension that would auto-capture a visitor's cookie and submit it for them.** Phase 3 as scoped here only builds the backend side (the store, the two endpoints, the resolution logic) — a visitor brings their own session by capturing it manually (DevTools) and submitting it themselves, the same way the project's own operator does. An extension to automate that capture is documented as README future work, not built now: it's the least testable, highest-risk piece (browser extension manifest, permissions, packaging) and Phase 3 already delivers its real value (no more redeploy-to-refresh, reviewers can bring their own session) without it.
- **A user-account system or token-recovery flow.** A token is a bare bearer credential; losing it just means submitting the session again.
- **Bulk/search endpoints, LinkedIn write actions (messaging, connecting, etc.)** — the challenge asks only for single-profile read access.
- **Guaranteed contact info (email, phone)** — LinkedIn restricts this heavily even for authenticated viewers; not a reliable field to promise.
- **A CI/CD pipeline beyond Vercel's own git-push deploy** — not required by the challenge.
- **An admin UI or dashboard** — the deliverable is an API, not a product surface; the admin endpoint is called directly (e.g. via curl/Postman), not through any UI.

## Further Notes

- Full technical mechanics (exact Voyager endpoint shapes, headers, login flow details for the Phase 2 stretch, file/folder structure, request pipeline, error-handling table) are captured in the earlier Plan-Mode design document; this spec's auth/session sequencing (Phase 1 required / Phase 2 stretch / Phase 3 stretch) supersedes that document's original "automated login is primary" framing. `CLAUDE.md` at the repo root reflects the same current framing and should be treated as the up-to-date source of truth alongside this spec.
- This technique violates LinkedIn's User Agreement; the account used is at risk of restriction. The README must state this plainly rather than omit it — this is a hiring-challenge submission, not a product being shipped to real users, so transparency here matters more than polish.
- Deadline is 2026-08-31. Given that, Phase 1 as scoped above — already complete and deployed — is the actual bar for a complete, submittable solution. Phase 3 is a genuine improvement on top of it, not a requirement; if it doesn't finish in time, Phase 1 stands on its own.
- Phase 3 exists because of concrete, observed friction (the session dying repeatedly, a reviewer having no recourse) discovered while operating the deployed Phase 1 system on 2026-08-30 — not a speculative feature. The security requirements (body/header only, never URL; constant-time secret comparison; no logging of secrets) were explicitly interrogated by the challenge submitter before this spec was written, prompted directly by an earlier close call in this same project where a raw session cookie was pasted into chat.
