# Cache profile responses to stop re-spending the shared LinkedIn session

> **Status:** done (2026-08-30)
> **Source:** architecture/scalability audit, 2026-08-30

## Problem Statement

Every call to the public profile endpoint fetches live from LinkedIn's internal API, even when the same profile was just requested seconds ago by a different caller. The project's own architecture identifies the shared LinkedIn account as the single scarcest, most ban-able resource in the system — but nothing currently stands between an incoming request and a fresh authenticated LinkedIn call. A profile linked from a popular page, or a client that retries/polls, multiplies real LinkedIn hits with zero benefit to anyone, and accelerates the exact rate-limit/ban exposure the whole reverse-engineering approach is designed to avoid.

## Solution

Add a short-TTL cache in front of the LinkedIn fetch step, keyed by the resolved profile identifier. A request first checks the cache; on a hit, it returns the cached, already-parsed response without touching LinkedIn at all. On a miss, it fetches and parses as today, then writes the result to the cache before responding. The cache lives in the same Redis instance already used for rate limiting and sessions, so no new infrastructure is introduced.

## User Stories

1. As the challenge submitter, I want repeat requests for the same profile within a short window to be served without a new LinkedIn call, so that the shared account isn't burned on duplicate work.
2. As the challenge submitter, I want the cache TTL to be short enough that reviewers/testers don't perceive obviously stale data, so that the tradeoff between freshness and account protection stays reasonable.
3. As an API caller, I want a cached response to be indistinguishable in shape from a live one, so that caching is an invisible optimization, not a behavior change I need to code around.
4. As the challenge submitter, I want the cache to be configurable via an environment variable (TTL in seconds), so that the tradeoff can be tuned post-deploy without a code change.
5. As the challenge submitter, I want a cache miss or a Redis outage to degrade gracefully to the current live-fetch behavior, so that caching is strictly additive and never a new failure mode.
6. As the challenge submitter, I want cache reads/writes to only ever store the already-parsed, public response shape (never raw LinkedIn payloads or session data), so that the cache can't become a new place secrets or unparsed internal data leak from.
7. As a maintainer, I want the cache module to expose a small, pure-ish interface (get-by-identifier, set-by-identifier) so it's trivially unit-testable without a real Redis connection.

## Implementation Decisions

- The existing (currently unimplemented) profile-cache module becomes the home for this: a `getCachedProfile(identifier)` / `setCachedProfile(identifier, profile)` pair built on the same Redis client already used elsewhere in the project.
- The cache sits between session resolution and the LinkedIn fetch step in the profile-request pipeline: check cache → on hit, respond immediately; on miss, resolve session → fetch → parse → write to cache → respond.
- Cache key is the resolved public identifier (the same identifier already used to build the outbound LinkedIn request), not the raw input URL, so that different URL forms pointing at the same profile share a cache entry.
- TTL is read from an environment variable with a conservative default (on the order of minutes, not hours) — this is a "protect the account from duplicate work" cache, not a long-lived freshness cache, so it should stay short.
- A cache read/write failure (Redis unreachable, malformed cached value) is treated as a miss, never as a request failure — the pipeline falls through to a live fetch exactly as it does today when Redis is unconfigured.
- No raw/unparsed LinkedIn data or session material is ever written to the cache — only the final public response shape.

## Testing Decisions

- Good tests here assert observable behavior: given a cache hit, no outbound LinkedIn call is made and the cached shape is returned unchanged; given a cache miss, the pipeline falls through to fetch-and-parse and then populates the cache; given a cache/Redis failure, the pipeline behaves exactly as it does today with caching disabled.
- Follow the existing pattern used for other pure-logic modules in this codebase (identifier resolution, response parsing): unit tests against the module directly, with the underlying Redis client faked/stubbed rather than hit for real, mirroring how rate-limiting and session-store tests already avoid live Redis in the unit suite.
- Add or extend a standalone verification script (matching the existing pattern of scripts that exercise real Redis/LinkedIn behavior outside the unit suite) to confirm a real cache hit skips the LinkedIn call end-to-end.

## Out of Scope

- Any cache invalidation trigger beyond TTL expiry (e.g. an explicit "purge this profile" admin action) — not needed for a short-TTL cache.
- Caching anything other than successful profile responses (errors, rate-limit responses, and session-related endpoints stay uncached).
- Changing the response schema or adding cache-related metadata (e.g. `cachedAt`) to the public API response — this should be invisible to callers.

## Further Notes

This is the highest-leverage finding from the audit: it's the one piece of work that most directly addresses "is this scalable" for a project whose real bottleneck is a single shared, ban-risking account rather than server throughput. It pairs naturally with the outbound-concurrency-control ticket (007) — a cache alone won't stop concurrent first-time requests for a newly-popular profile from piling up, which is what 007 addresses — but this ticket stands on its own and should land first.
