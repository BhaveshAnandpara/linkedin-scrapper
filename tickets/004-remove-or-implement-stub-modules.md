# Resolve the two empty stub modules before submission

> **Status:** done (2026-08-30) — profileCache stub implemented for real by ticket 001; logger stub deleted (zero importers, only one non-secret console.warn call exists in the codebase)
> **Source:** architecture audit, 2026-08-30

## Problem Statement

Two source modules exist in the tree as empty placeholders whose header comments describe real functionality — a structured, secret-redacting logger, and a response cache — neither of which is implemented. A hiring-challenge reviewer skimming the file tree reasonably assumes both exist and work, since the files are sitting alongside real, functioning modules with no visible marker that they're stubs. This is a first-impression cost distinct from either feature being an intentionally cut stretch goal — the problem is the stub files themselves being indistinguishable from real ones at a glance.

## Solution

For each stub, make a deliberate call and act on it: either delete the file (if the feature isn't being built before submission) or implement the minimal version its own comment already describes. This ticket assumes the profile-cache stub is superseded by ticket 001 (which implements it for real), and resolves the logger stub on its own merits.

## User Stories

1. As a hiring reviewer, I want every file in the source tree to reflect something that actually exists, so that I can trust my first read of the project's structure.
2. As the challenge submitter, I want the profile-cache stub's fate tied to ticket 001 — implemented for real once that ticket lands, not left as a dangling empty file — so that there's exactly one place this decision is recorded.
3. As the challenge submitter, I want a decision made on the logger stub specifically: either implement the minimal secret-redacting wrapper it describes, or delete it, so that it stops misrepresenting the project's logging story.
4. As a maintainer, I want any ad hoc logging calls scattered across the codebase to go through one logging module if that module is implemented, so that redaction of session values from log output is enforced in one place rather than trusted to every call site individually.

## Implementation Decisions

- Profile-cache stub: resolved by ticket 001 (implements it), not by this ticket — this ticket only needs to confirm the stub no longer exists as a dead empty file once 001 lands.
- Logger stub: implement a minimal wrapper around the existing ad hoc logging calls that redacts known session-secret values (the two cookie/session values already named in this project's environment configuration) before anything reaches stdout, and route the currently scattered direct logging calls through it.
- If the logger is judged out of scope for the remaining time before submission, delete the stub file outright rather than leave it — an absent file makes no claim; an empty one does.
- Whichever path is chosen, the decision and reasoning should be reflected in the file itself (a real implementation) or by the file's absence — not left as a comment promising something that isn't there.

## Testing Decisions

- If implemented: a test confirming that a log call containing a known session-secret field is redacted before the underlying log function is invoked, following whatever unit-testing pattern this codebase already uses for small utility modules (e.g. the identifier or IP utilities).
- If deleted: no test obligation — confirm via a repo-wide search that nothing imports the removed module before deleting it.

## Out of Scope

- Building a full structured-logging system (log levels, transports, correlation IDs) — the described scope is redaction of secrets from existing log output, nothing more.
- Retrofitting every existing log call site in one pass if time is short — even routing the highest-risk call sites (the session endpoints) through a real redacting logger is a meaningful improvement over the current stub.

## Further Notes

Lowest-risk ticket in this set — it's a documentation-honesty and first-impression fix as much as a functional one, and matters specifically because this repository will be read by a hiring reviewer.
