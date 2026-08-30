# Rate limit the session-submission endpoints

> **Status:** done (2026-08-30)
> **Source:** security audit, 2026-08-30

## Problem Statement

The public bring-your-own-session endpoint and the admin default-session-refresh endpoint both skip the rate limiting that already protects the profile endpoint. Anyone can call the public session endpoint as fast as they like, and there is no attempt cap on guessing the admin secret either (even though the comparison itself is already safely constant-time). This leaves two state-changing endpoints — one of which can overwrite the session powering all public traffic — without the one throttle that exists elsewhere in the system.

## Solution

Apply the same per-IP rate-limiting mechanism already used on the profile endpoint to both session endpoints, with a stricter limit appropriate to how rarely a legitimate caller needs to hit them (a handful of times per minute, not the profile endpoint's read-heavy allowance).

## User Stories

1. As the challenge submitter, I want the public session-submission endpoint rate-limited per IP, so that it can't be used to cheaply flood session storage with junk entries.
2. As the challenge submitter, I want the admin default-session-refresh endpoint rate-limited per IP, so that repeated guesses against the admin secret are throttled even though the comparison itself is already timing-safe.
3. As an API caller submitting a real session, I want a generous-enough limit that normal, occasional use is never blocked, so that the throttle only affects abusive call volume.
4. As the challenge submitter, I want the rate-limit failure response on these endpoints to reuse the same error shape and status code already used on the profile endpoint, so that the API's error contract stays consistent across all three public-facing routes.
5. As the challenge submitter, I want this to reuse the existing rate-limiting module rather than introduce a second implementation, so that there is exactly one place that defines what "rate limited" means in this system.

## Implementation Decisions

- Both session endpoints call the existing rate-limit check (the same one already used ahead of the LinkedIn call on the profile endpoint), keyed by client IP, before doing any other work — including, on the admin endpoint, before the admin-secret comparison, so that even failed-auth attempts count against the limit.
- The two endpoints get their own, stricter limit/window configuration (separate from the profile endpoint's), since legitimate traffic to them is expected to be rare and bursty-abuse is the main risk being defended against.
- The existing "fail open when rate limiting isn't configured" behavior is preserved here for consistency with the profile endpoint, pending the separate fail-closed-in-production decision covered in ticket 003.
- Response shape/status code on a rate-limit hit matches what the profile endpoint already returns for the same condition.

## Testing Decisions

- Good tests assert observable behavior: given N+1 requests from the same IP within the window, the (N+1)th is rejected with the rate-limited response, regardless of whether the submitted session data or admin secret would otherwise have been valid.
- Follow the existing pattern used for the profile endpoint's rate-limit tests (and the standalone rate-limit verification script already in the project) — same assertion style, applied to the two session endpoints.
- Confirm via test that a request rejected for rate-limiting never reaches session storage or the admin-secret comparison — the check must run first.

## Out of Scope

- Changing the profile endpoint's existing rate-limit configuration.
- Any new rate-limiting backend or algorithm — this reuses what already exists.
- IP-spoofing hardening (trusting proxy headers) — noted separately as a lower-confidence item from the audit, not part of this ticket.

## Further Notes

This is a small, low-risk, high-leverage fix: it closes the one clear gap between "what the profile endpoint already defends against" and "what the two newer session endpoints don't." Should land alongside ticket 003 (fail-closed rate limiting in production), since both concern the same underlying rate-limit module.
