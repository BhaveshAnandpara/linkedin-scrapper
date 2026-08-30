# Architecture

This documents how the LinkedIn Profile API is put together — the request pipeline, module boundaries, and the session-resolution logic that spans Phase 1 and Phase 3. For setup and API usage, see [README.md](README.md); for the full design rationale and decision history, see [docs/specs/linkedin-profile-api.md](docs/specs/linkedin-profile-api.md).

## System overview

```mermaid
graph TB
    subgraph "API Layer (Vercel serverless functions)"
        Aprofile["api/profile.ts<br/>GET /api/profile"]
        Ahealth["api/health.ts<br/>GET /api/health"]
        Asessions["api/sessions.ts<br/>POST /api/sessions"]
        Adefault["api/sessions/default.ts<br/>POST /api/sessions/default"]
    end

    subgraph "src/linkedin — LinkedIn integration"
        Resolver["sessionResolver.ts"]
        Session["session.ts"]
        Ident["identifiers.ts"]
        Fetcher["profileFetcher.ts"]
        Voyager["voyagerClient.ts"]
        Parser["profileParser.ts"]
    end

    subgraph "src/sessions — Phase 3"
        Store["sessionStore.ts"]
    end

    subgraph "src/rateLimit, src/cache, src/utils"
        RateLimit["rateLimiter.ts"]
        Redis["redisClient.ts"]
        Errors["errors.ts"]
        IP["ip.ts"]
        AdminSecret["adminSecret.ts"]
    end

    LinkedInAPI[("LinkedIn Voyager API<br/>external, undocumented")]
    RedisDB[("Upstash Redis<br/>external")]

    Aprofile --> RateLimit
    Aprofile --> Resolver
    Aprofile --> Fetcher
    Aprofile --> Parser
    Aprofile --> Errors
    Aprofile --> IP

    Asessions --> Store
    Adefault --> Store
    Adefault --> AdminSecret

    Resolver --> Session
    Resolver --> Store

    Fetcher --> Ident
    Fetcher --> Voyager
    Voyager -.uses.-> Session

    Store --> Redis
    RateLimit --> Redis

    Voyager -->|HTTPS| LinkedInAPI
    Redis -->|REST API| RedisDB

    style Aprofile fill:#4ecdc4
    style Parser fill:#ff6b6b
    style Store fill:#ffd93d
    style LinkedInAPI fill:#eee,stroke:#999
    style RedisDB fill:#eee,stroke:#999
```

**The one rule that shapes everything:** raw LinkedIn access (`voyagerClient.ts`, `profileFetcher.ts`) and response shaping (`profileParser.ts`, highlighted above) are strictly separate layers. LinkedIn's internal API is undocumented and drifts over time — keeping these separate means a shape change only ever breaks the parser, never the fetch/auth logic.

## Request flow: `GET /api/profile`

This is the core pipeline, and the one place Phase 1 and Phase 3 meet: session resolution now has three tiers instead of one.

```mermaid
sequenceDiagram
    actor Client
    participant API as api/profile.ts
    participant RL as rateLimiter
    participant Resolver as sessionResolver
    participant Store as sessionStore (Redis)
    participant EnvSession as session.ts (env vars)
    participant Fetcher as profileFetcher + voyagerClient
    participant LinkedIn as LinkedIn Voyager API
    participant Parser as profileParser

    Client->>API: GET /api/profile?url=...<br/>[Authorization: Bearer token]?

    API->>API: validate url present
    alt url missing/malformed
        API-->>Client: 400 INVALID_URL
    end

    API->>RL: checkRateLimit(clientIp)
    alt over limit
        API-->>Client: 429 RATE_LIMITED
    end
    Note over RL: fails OPEN if Redis unconfigured — warns, doesn't block

    API->>Resolver: resolveRequestSession(bearerToken)

    alt bearer token supplied
        Resolver->>Store: getVisitorSession(token)
        alt token found
            Store-->>Resolver: StoredSession
        else token not found
            Note over Resolver: never falls through to the shared default —<br/>a bad token is its own distinct failure
            Resolver-->>API: error SESSION_EXPIRED
            API-->>Client: 401 SESSION_EXPIRED
        end
    else no token
        Resolver->>Store: getDefaultSession()
        alt default session stored
            Store-->>Resolver: StoredSession
        else no default stored
            Resolver->>EnvSession: getSession(process.env)
            EnvSession-->>Resolver: Session or SESSION_NOT_CONFIGURED
        end
    end

    Resolver-->>API: Session (cookieHeader, csrfToken, userAgent)

    API->>Fetcher: fetchRawProfile(url, session)
    Fetcher->>LinkedIn: GET voyager/api/identity/dash/profiles?...
    alt LinkedIn 200
        LinkedIn-->>Fetcher: raw profile JSON
    else LinkedIn 401/403/302
        LinkedIn-->>Fetcher: challenge / expired
        Fetcher-->>API: error SESSION_EXPIRED
        API-->>Client: 401 SESSION_EXPIRED
    else LinkedIn 404 / 429 / other
        LinkedIn-->>Fetcher: not found / rate limited / upstream error
        Fetcher-->>API: typed error
        API-->>Client: 404 / 502 / 500
    end

    API->>Parser: parseProfile(rawJson, requestedUrl)
    Parser-->>API: ProfileResponse (partial: true/false)
    API-->>Client: 200 ProfileResponse
```

**Session priority, in one line:** a visitor's own bearer token &gt; the shared Redis-stored default &gt; the original `LI_AT_COOKIE`/`LI_JSESSIONID` env vars. Each tier is only consulted if the one before it isn't available — this is `resolveSessionSource()` in `sessionStore.ts`, the one pure, unit-tested decision in the whole session-handling layer. Everything else touching a session depends on live external state (a real LinkedIn session, a real Redis instance) and is verified with the `scripts/*.ts` standalone scripts instead of automated tests.

## Request flow: bring-your-own-session (Phase 3)

```mermaid
sequenceDiagram
    actor Visitor
    participant Sessions as api/sessions.ts
    participant Store as sessionStore (Redis)

    Visitor->>Sessions: POST /api/sessions<br/>body: {liAt, jsessionid, userAgent?}
    Note over Visitor,Sessions: session values in the BODY only — never URL query params
    Sessions->>Sessions: validate body
    alt missing/empty fields
        Sessions-->>Visitor: 400 INVALID_SESSION_DATA
    end
    Sessions->>Store: storeVisitorSession(session)
    Store->>Store: generateToken() — crypto.randomUUID()
    Store-->>Sessions: {token}
    Sessions-->>Visitor: 200 {token}
    Note over Visitor: use later via Authorization: Bearer token
```

```mermaid
sequenceDiagram
    actor Admin
    participant Default as api/sessions/default.ts
    participant Auth as adminSecret.ts
    participant Store as sessionStore (Redis)

    Admin->>Default: POST /api/sessions/default<br/>header: X-Admin-Secret<br/>body: {liAt, jsessionid}
    Default->>Auth: verifyAdminSecret(provided, ADMIN_SECRET)
    Note over Auth: constant-time comparison — timing-attack resistant
    alt secret wrong/missing
        Auth-->>Default: false
        Default-->>Admin: 401 UNAUTHORIZED
    end
    Default->>Default: validate body
    alt missing/empty fields
        Default-->>Admin: 400 INVALID_SESSION_DATA
    end
    Default->>Store: storeDefaultSession(session)
    Store-->>Default: ok
    Default-->>Admin: 200 {ok: true}
    Note over Admin,Store: every subsequent no-token /api/profile request<br/>now uses this session — no redeploy
```

## Module responsibilities

| Module | Responsibility | Depends on |
|---|---|---|
| `api/profile.ts` | Orchestrates one request: validate → rate limit → resolve session → fetch → parse → respond | Everything below |
| `src/linkedin/sessionResolver.ts` | Three-tier session priority (token → default → env) | `session.ts`, `sessionStore.ts` |
| `src/linkedin/session.ts` | `buildSession()` — pure: raw values → `Session`; `getSession()` — env vars → `Session`, unchanged since Phase 1 | — |
| `src/sessions/sessionStore.ts` | Redis-backed session storage (token-keyed + reserved `"default"` key); `resolveSessionSource()` — the one pure TDD seam | `redisClient.ts` |
| `src/linkedin/identifiers.ts` | Pure: `linkedin.com/in/{slug}` URL → identifier, or `INVALID_URL` | — |
| `src/linkedin/voyagerClient.ts` | Raw HTTP to LinkedIn's Voyager API; classifies the response into typed success/error | `session.ts` (types only) |
| `src/linkedin/profileFetcher.ts` | Composes `identifiers.ts` + `voyagerClient.ts` | Both |
| `src/linkedin/profileParser.ts` | Pure: raw undocumented JSON → `ProfileResponse`. Primary test seam — TDD'd against real captured fixtures | — |
| `src/rateLimit/rateLimiter.ts` | Per-IP sliding-window limit via Upstash; fails open if unconfigured | `redisClient.ts` |
| `src/cache/redisClient.ts` | Shared Upstash Redis client, returns `null` if unconfigured rather than throwing | — |
| `src/utils/errors.ts` | `ApiErrorCode` → HTTP status map, envelope builder | — |
| `src/utils/ip.ts` | Pure: extracts client IP from headers/socket | — |
| `src/utils/adminSecret.ts` | Pure: constant-time secret comparison | — |
| `src/types/profile.ts` | The `ProfileResponse`/`ApiErrorResponse` contract | — |
| `src/types/linkedin-raw.ts` | Loose types for LinkedIn's raw JSON, only the fields actually consumed | — |

## Testing strategy

Per `docs/specs/linkedin-profile-api.md`'s Testing Decisions: test external behavior at the highest-value seam; verify anything touching live external state (a real LinkedIn session, a real Redis instance) with standalone scripts instead of mocks that would only prove the mock works.

| Seam | How it's tested |
|---|---|
| `profileParser.ts` | TDD, real captured LinkedIn JSON fixtures — the primary seam, since this is what LinkedIn's drift actually breaks |
| `identifiers.ts` | TDD, valid/invalid URL shapes |
| `sessionStore.ts`'s `resolveSessionSource()` | TDD, all 4 meaningful flag combinations — the one pure decision Phase 3 introduces |
| Everything else (session, live fetch, Redis, rate limiting, both new endpoints end-to-end) | `scripts/*.ts`, run against the real services |

## Error handling

Every failure mode returns `{ error: { code, message } }` with a status from the same map (`src/utils/errors.ts`) — see the README's API section for the full code table. The two Phase 3 additions (`INVALID_SESSION_DATA`, `UNAUTHORIZED`) follow the same pattern rather than overloading an existing code with a misleading meaning.

## Known architectural limitations

See the README's [Known Limitations](README.md#known-limitations) section for the full list (session expiry frequency, plaintext-in-Redis, private-vs-not-found ambiguity, etc.) — kept in one place rather than duplicated here.
