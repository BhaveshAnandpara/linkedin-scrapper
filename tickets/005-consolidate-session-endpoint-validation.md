# Consolidate duplicated validation and error-response logic across API handlers

> **Status:** done (2026-08-30)
> **Source:** architecture audit, 2026-08-30

## Problem Statement

The two session-related endpoints each define their own, byte-for-byte identical copy of the request-body shape, the parsing/validation function that checks it, and the error-response helper. The profile endpoint separately re-implements the same error-response helper body a third time. Nothing enforces that these copies stay identical — a future change to validation rules (a new field, a stricter check) or to the error-response convention has to be found and applied in two or three places by hand, and the two validation copies could silently drift apart without anyone noticing.

## Solution

Extract the shared pieces into single, imported definitions: the request-body type and its parsing/validation function move into the session-storage module both session endpoints already depend on; the error-response helper moves into the existing shared errors module that already owns the related error-code-to-status mapping. Both endpoints import from these single sources instead of redefining them.

## User Stories

1. As a maintainer, I want the session-submission request shape and its validation defined exactly once, so that a future rule change only needs to happen in one place.
2. As a maintainer, I want the error-response helper defined exactly once and reused by every API handler, so that the response envelope stays consistent by construction rather than by convention.
3. As the challenge submitter, I want this refactor to change no observable behavior — same validation rules, same error shapes, same status codes — so that existing tests and verification scripts continue to pass unmodified.
4. As a future contributor, I want to be able to add a new API handler by importing the existing validation and error helpers rather than being tempted to copy-paste from an existing one, so that the pattern doesn't keep re-duplicating.

## Implementation Decisions

- The session-submission request type and its parsing/validation function move into the module that already owns session storage (the natural home, since both session endpoints already import from it) and are imported by both endpoints rather than redefined.
- The error-response helper moves next to the existing error-code-to-status mapping and error-envelope builder in the shared errors module, and is imported by all three API handlers (profile, and both session endpoints).
- No change to validation rules, error codes, status codes, or response shapes — this is a pure consolidation, not a behavior change.
- Each handler's remaining code (its own method check, its own business logic) stays where it is; only the genuinely identical pieces move.

## Testing Decisions

- This is a behavior-preserving refactor: the existing test suite and standalone verification scripts covering the session endpoints and the profile endpoint are the acceptance criteria — they must pass unmodified before and after.
- No new tests are strictly required since no new behavior is introduced, but if the extracted validation function doesn't already have direct unit coverage, add a small unit test for it in its new home, following the pattern used for the other pure-logic modules already tested in this codebase (identifier resolution, IP parsing).

## Out of Scope

- Changing what fields the session-submission body accepts or how they're validated.
- Introducing a schema-validation library — the existing hand-written validation function is preserved as-is, just relocated and shared.
- Touching the profile endpoint's non-error-response logic.

## Further Notes

Small, safe, well-covered-by-existing-tests refactor — good candidate to batch with tickets 004 and 006, all three of which are low-risk cleanup with clear existing verification.
