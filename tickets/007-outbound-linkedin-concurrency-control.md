# De-duplicate and cap concurrent outbound LinkedIn calls

> **Status:** done (2026-08-30)
> **Source:** performance/scalability audit, 2026-08-30

## Problem Statement

Nothing currently limits how many outbound LinkedIn calls can be in flight at once under the same shared session. Per-IP rate limiting protects against one abusive caller, but does nothing when many different callers hit the same newly-popular profile URL at roughly the same time, or when several different profile URLs happen to be requested concurrently — every one of those becomes an independent, simultaneous authenticated call against the same account. A burst of concurrent calls under one account is exactly the pattern LinkedIn's anti-scraping detection is designed to catch, independent of anything per-IP rate limiting can see.

## Solution

Add two complementary protections in front of the outbound LinkedIn call: request de-duplication (concurrent requests for the *same* profile identifier share one in-flight LinkedIn call rather than each starting their own), and a global concurrency cap (no more than a configured number of outbound LinkedIn calls in flight at once, regardless of which profiles they're for). Requests beyond the cap wait briefly or receive a clear "try again shortly" response rather than piling on.

## User Stories

1. As the challenge submitter, I want concurrent requests for the same profile to share a single outbound LinkedIn call, so that a sudden burst of interest in one profile doesn't multiply real LinkedIn hits.
2. As the challenge submitter, I want a hard ceiling on how many LinkedIn calls can be in flight at once under the shared session, so that aggregate concurrent load — however it's distributed across callers or profiles — can never exceed a safe, deliberately chosen level.
3. As an API caller whose request arrives while the concurrency cap is already full, I want a clear, typed response telling me to retry shortly, so that the failure mode is predictable rather than a hang or a generic error.
4. As the challenge submitter, I want the concurrency cap to be configurable via an environment variable, so that the safe threshold can be tuned post-deploy based on observed LinkedIn behavior without a code change.
5. As the challenge submitter, I want this mechanism to compose cleanly with the profile cache (ticket 001) — a cache hit should never count against the concurrency cap, only real outbound calls should, so that the two protections reinforce rather than fight each other.

## Implementation Decisions

- Request de-duplication uses an in-flight tracking structure keyed by the resolved profile identifier: a second concurrent request for an identifier already being fetched attaches to the same in-progress result instead of starting a new LinkedIn call, and both requests resolve together once the single fetch completes.
- The global concurrency cap is enforced immediately before the outbound LinkedIn call, independent of which identifier is being fetched — implemented as a lease/semaphore that any in-flight call must hold, released when that call completes (success or failure).
- Given the serverless/stateless-between-invocations nature of this deployment, the concurrency and de-duplication state needs to live somewhere that survives across invocations — using the same Redis instance already relied on elsewhere in this project (e.g. via a short-lived lock/lease pattern) rather than in-process memory, which would not be shared across concurrent serverless instances.
- A request that can't acquire a lease within a short bounded wait returns a distinct, typed "LinkedIn is at capacity, try again shortly" error rather than blocking indefinitely or falling through to an unprotected call.
- This sits after the profile-cache check (ticket 001) in the pipeline — a cache hit resolves without ever touching the concurrency/de-dup layer at all.

## Testing Decisions

- Good tests assert observable behavior rather than timing internals: two concurrent requests for the same identifier result in exactly one underlying LinkedIn fetch call being made (verifiable by counting calls to the fetch layer with a stub in place of the real HTTP client); requests beyond the configured concurrency cap receive the capacity-exceeded response rather than proceeding.
- Given the inherent difficulty of deterministically testing real concurrency, follow whatever pattern this codebase already uses for testing modules with real external dependencies (Redis-backed rate limiting, session storage) — unit-level tests with a faked backing store for the deterministic logic (lease acquire/release, de-dup bookkeeping), plus a standalone verification script exercising real concurrent requests against a real deployment for end-to-end confidence, mirroring the project's existing script-based verification approach for external-system-dependent behavior.

## Out of Scope

- Queueing/backpressure beyond a short bounded wait — this ticket rejects with a clear error past the cap rather than building a full request queue.
- Per-session (as opposed to global) concurrency accounting for the bring-your-own-session case — this ticket scopes the cap to the shared default session, which is the one facing uncontrolled public traffic; visitor-submitted sessions are each used by a single caller and carry proportionally lower burst risk.

## Further Notes

This is the largest and riskiest ticket in the set (new failure mode to reason about, coordination logic to get right) and is explicitly the one item the accompanying audit flagged as reasonable to defer past an imminent deadline if time runs short — land ticket 001 (caching) first, since it independently reduces how often this code path is even exercised.
