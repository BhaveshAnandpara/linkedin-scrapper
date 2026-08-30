# Share the LinkedIn decorationId constant instead of duplicating it

> **Status:** done (2026-08-30)
> **Source:** architecture audit, 2026-08-30

## Problem Statement

The exact LinkedIn `decorationId` value used to fetch a full profile is declared independently in two places: the profile-fetching module, and a standalone verification script used to confirm a captured session is still valid. This project's own design documentation calls this value out by name as the single piece of LinkedIn's undocumented internal API most likely to drift over time. If it changes, updating only the profile-fetching module leaves the verification script silently checking against a stale value — producing a confusing mismatch where the real endpoint works but its own "is my session still good" check reports failure, or vice versa.

## Solution

Declare the `decorationId` constant once, exported from the profile-fetching module, and have the verification script import it instead of redeclaring the literal.

## User Stories

1. As the challenge submitter, I want the `decorationId` value declared in exactly one place, so that updating it when LinkedIn's API drifts is a single, unambiguous edit.
2. As the challenge submitter, I want the session-verification script to always test against the same `decorationId` the production code actually uses, so that its pass/fail result is trustworthy.
3. As a maintainer, I want this shared constant to be the obvious, discoverable place to update when a future profile-fetch failure investigation points at the decoration value, so that the fix isn't accidentally applied to only one of the two call sites.

## Implementation Decisions

- The constant is exported from the profile-fetching module, which is its natural owner (it's the module that builds the real outbound request).
- The verification script imports the exported constant rather than declaring its own literal.
- No behavior change: the value itself is unchanged, only its ownership is consolidated.

## Testing Decisions

- No new test is required beyond confirming (by running the existing verification script) that it still behaves identically after switching to the imported constant — this is a pure deduplication with no logic change.

## Out of Scope

- Any change to the decorationId value itself, or to how the profile-fetch request is constructed.
- Building tooling to detect decorationId drift automatically — out of scope; this ticket only removes the duplication that would make a manual fix error-prone.

## Further Notes

Smallest ticket in this set — a few minutes of work, but directly protects a mechanism this project's own documentation flags as its most fragile point.
