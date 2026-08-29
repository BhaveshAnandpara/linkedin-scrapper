# LinkedIn Profile API — Specification

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

## Out of Scope

- **Automated LinkedIn login (Phase 2).** Explicitly deferred. If time remains after the Phase 1 system above is built, deployed, and verified working end-to-end, automated username/password login (with session self-healing on expiry) may be added as a separate, additive piece of work — its own spec/plan if pursued, not covered by this document.
- **Any browser automation**, at any point in the request-serving path — disallowed by the challenge's explicit clarification.
- **An API key / authenticated access model** for our own public endpoint — deliberately left open (rate-limiting is the only protection) so reviewers can test it without needing credentials from us.
- **Bulk/search endpoints, LinkedIn write actions (messaging, connecting, etc.)** — the challenge asks only for single-profile read access.
- **Guaranteed contact info (email, phone)** — LinkedIn restricts this heavily even for authenticated viewers; not a reliable field to promise.
- **A CI/CD pipeline beyond Vercel's own git-push deploy** — not required by the challenge.
- **An admin UI or dashboard** — the deliverable is an API, not a product surface.

## Further Notes

- Full technical mechanics (exact Voyager endpoint shapes, headers, login flow details for the Phase 2 stretch, file/folder structure, request pipeline, error-handling table) are captured in the earlier Plan-Mode design document; this spec's auth/session sequencing (Phase 1 required / Phase 2 stretch) supersedes that document's original "automated login is primary" framing. `CLAUDE.md` at the repo root reflects the same current framing and should be treated as the up-to-date source of truth alongside this spec.
- This technique violates LinkedIn's User Agreement; the account used is at risk of restriction. The README must state this plainly rather than omit it — this is a hiring-challenge submission, not a product being shipped to real users, so transparency here matters more than polish.
- Deadline is 2026-08-31. Given that, Phase 1 as scoped above — not Phase 2 — is the actual bar for a complete, submittable solution.
