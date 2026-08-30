# Fail closed on rate-limit misconfiguration in production

> **Status:** done (2026-08-30)
> **Source:** security/scalability audit, 2026-08-30

## Problem Statement

If the Redis environment variables the rate limiter depends on are ever missing in the deployed environment, the current behavior is to log a warning and let the request proceed unlimited. That fail-open behavior is the right default for local development, where no one wants Redis to be a hard requirement just to run the API. But the exact same code path fires in a misconfigured production deployment, and the only signal is a `console.warn` easy to miss in serverless logs — silently removing the one throttle protecting the shared LinkedIn account from unbounded call volume.

## Solution

Make the rate limiter distinguish "expected local dev without Redis configured" from "running in production without Redis configured." In the former case, keep today's fail-open behavior unchanged. In the latter, fail closed — reject the request with a clear internal-error response instead of proceeding unprotected.

## User Stories

1. As the challenge submitter, I want a production deployment missing its Redis configuration to refuse requests rather than silently run unprotected, so that a configuration mistake can't quietly expose the LinkedIn account to unlimited call volume.
2. As a local developer, I want the API to keep working without Redis configured, so that day-to-day development isn't blocked on setting up rate-limiting infrastructure.
3. As the challenge submitter, I want the failure in the production/misconfigured case to return a clear, typed error response (not a raw crash or an unrelated error code), so that the failure mode is diagnosable from outside.
4. As the challenge submitter, I want this check based on the deployment environment (not a heuristic guess), so that the distinction between "local" and "production" is unambiguous.

## Implementation Decisions

- The environment check uses the platform's own environment signal (the same one Vercel already sets to distinguish production from preview/development deployments) rather than inferring it from the presence/absence of other variables.
- When rate limiting is unconfigured and the environment signal indicates production, the pipeline returns an internal-error response and does not proceed to the LinkedIn call — mirroring how other unrecoverable configuration problems already short-circuit the pipeline elsewhere in this codebase.
- When rate limiting is unconfigured and the environment signal indicates anything other than production (local dev, preview), today's fail-open behavior and warning log are unchanged.
- This check lives at the same call site already deciding what to do with the rate-limit result, not inside the rate-limiter module itself — the rate limiter's job stays "report whether it's configured," not "decide what that means for the caller."

## Testing Decisions

- Good tests assert observable behavior: with the environment signal set to production and rate limiting unconfigured, the request is rejected with the internal-error response before any LinkedIn call is attempted; with the environment signal set to anything else, the request proceeds as it does today.
- Follow the existing pattern for testing environment-dependent behavior and for testing the rate-limit call site's other branches (the "configured and limited" / "configured and not limited" cases already covered).

## Out of Scope

- Adding alerting/monitoring integration for this condition — the fix here is behavioral (fail closed), not observability tooling.
- Changing fail-open-vs-closed behavior for any other feature that depends on Redis (session storage, caching) — this ticket is scoped to the rate limiter only.

## Further Notes

Pairs naturally with ticket 002 (rate limiting on the session endpoints) — both touch the same rate-limit call sites and are small enough to land together.
