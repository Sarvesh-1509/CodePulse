# CodePulse Architecture (Modules 0–14)

## Repository layout

```text
codepulse/
  package.json            # npm workspaces + cross-platform root scripts
  frontend/               # Next.js App Router application
    src/app/              # layout.tsx, page.tsx, globals.css
    src/components/ui/    # shadcn-style primitives (button.tsx)
    src/lib/              # utils.ts (cn), tests
  backend/                # Express + TypeScript API
    src/app.ts            # createApp() factory (importable, no listen; accepts adapter overrides)
    src/server.ts         # HTTP bootstrap (listen only)
    src/config/env.ts     # Zod-validated environment (+ JWT_SECRET rules, sync timeouts)
    src/db/prisma.ts      # Prisma singleton + checkDatabase()
    src/scripts/db-check.ts # connectivity gate for CI/operators
    src/middleware/       # notFound, errorHandler, csrf (same-origin)
    src/modules/auth/     # register/login/logout/me, JWT cookies, rate limits
    src/modules/users/    # GET/PATCH /users/me (self only)
    src/modules/platforms/ # registry, adapter contract, HTTP helper, account
                          # orchestration (list/connect/disconnect/sync), routes
    src/modules/codeforces/ # official API client + adapter (profile, rating,
                          # submissions)
    src/modules/leetcode/ # best-effort GraphQL adapter (profile, splits, contest)
    src/modules/codechef/ # best-effort profile-page adapter (rating, ranks,
                          # solved, contest history)
    src/modules/geeksforgeeks/ # best-effort profile-page adapter (score, solved)
    src/modules/hackerrank/ # best-effort profile-page adapter (badges, scores)
    src/routes/           # health + health/db mounted at /api
    src/utils/httpError.ts# status-coded errors for the central handler
    src/utils/streaks.ts  # pure day-bucketing + streak math (shared by activity + rating)
    src/modules/activity/ # streak/days/recent reads over ActivityEvent, coverage
    src/modules/rating/   # CPR formula v1.0.0, lazy idempotent snapshots, history
    prisma/schema.prisma  # User, LinkedAccount (+contestResults), PlatformStats,
                          # ActivityEvent, ContestResult, RatingSnapshot (+formulaVersion),
                          # Room, RoomMember
    prisma/migrations/    # ordered, never hand-edited after applying
    tests/                # Supertest + Vitest (isolated test database; live.test.ts
                          # runs only with LIVE_API=1)
  packages/shared/        # API contracts shared by backend + frontend
    src/index.ts          # ApiResponse, ok(), fail()
    src/auth.ts           # SafeUser, auth request/response DTOs
    src/platforms.ts      # PlatformInfo, LinkedAccountDto, stats DTOs
    src/activity.ts       # streak, day-bucket, coverage, feed DTOs
    src/rating.ts         # CPR + snapshot DTOs
  frontend/
    src/components/platform-accounts.tsx # Coding Platforms dashboard section
    src/components/cpr-card.tsx, streak-card.tsx, activity-heatmap.tsx,
      recent-activity.tsx, analytics-charts.tsx # dashboard sections (props-driven)
    src/lib/api.ts        # authenticated fetch client (cookies included)
    src/lib/dashboard.ts  # pure heatmap/formatting helpers (unit-tested)
  docs/
    cpr-formula.md        # CPR v1.0.0 specification (weights, ceilings, policy)
```

## Frontend / backend separation

- **Frontend** owns rendering, routing, and (later) data fetching. It never imports backend internals. In later modules it will call the backend over HTTP (`NEXT_PUBLIC_API_URL` or similar) and render with Recharts.
- **Backend** owns HTTP, validation (Zod), auth, business logic, and (later) Prisma/PostgreSQL access. `app.ts` exports `createApp()` with no side effects so tests can import it without opening a port. `server.ts` is the only place that calls `listen()`.
- **Shared** owns serialisable contracts both sides can depend on (`ApiResponse<T>`, helpers). Frontend and backend may import `@codepulse/shared`; shared must never import from frontend or backend, keeping the dependency graph acyclic.

## Request lifecycle (Modules 1–11)

```text
Browser -> Next.js (3000) /register -> POST :5000/api/auth/register
        <- Set-Cookie: codepulse_session (HttpOnly, SameSite=Lax)
Browser -> Next.js (3000) /dashboard -> GET :5000/api/auth/me (cookie) -> SafeUser
Browser -> dashboard "Coding Platforms" -> GET :5000/api/platforms (public metadata)
        -> POST :5000/api/platform-accounts/codeforces/connect {username}
        -> backend verifies via codeforces.com/api, persists stats (txn)
        -> POST :5000/api/platform-accounts/leetcode/sync (manual refresh)
Browser -> dashboard sections (parallel) -> GET :5000/api/activity/streak
        -> GET :5000/api/activity/days?days=364 (heatmap buckets)
        -> GET :5000/api/activity/recent?limit=10 (feed)
        -> GET :5000/api/rating (lazy recalculation + snapshot if changed)
curl    -> Express (5000) /api/health    -> JSON { success, message, timestamp } (unchanged)
curl    -> Express (5000) /api/health/db -> JSON { success, data: { database, latencyMs } }
```

All third-party traffic stays server-side: the browser never calls codeforces.com or leetcode.com directly. Adapters fetch first, then persist inside short transactions; failed syncs keep cached data and record a sanitized `lastSyncError`. Dashboard reads (streaks, CPR) aggregate already-stored rows — syncs never block page loads.

CORS is restricted to `FRONTEND_URL` (default `http://localhost:3000`). Unknown routes return JSON 404 via `notFoundHandler`; thrown errors funnel through `errorHandler`, which hides stack traces in production and never echoes secrets.

## Auth security model

Stateless HS256 JWT (`sub` = user id, 24h expiry) in the `codepulse_session` HttpOnly cookie. No token in bodies or JS. `Secure` in production, `SameSite=Lax`, host-only, path `/`. Logout clears the cookie but cannot revoke the stateless token — the 24h lifetime bounds that window. Layers: explicit CORS origin + credentials, `requireSameOrigin` CSRF check on `/api/auth` and `/api/users` state changes, per-app rate limiters (login 10/10min, register 20/hour), bcrypt-12 password hashing, Zod strict schemas, `toSafeUser()` serialization.

## Configuration

Environment is validated once at import time with Zod (`backend/src/config/env.ts`). `NODE_ENV`, `PORT`, `FRONTEND_URL` boot the app; `DATABASE_URL` is required for DB-backed endpoints (clear failures, never silent); `JWT_SECRET` must be ≥32 chars in production (startup throws otherwise) while development/test use a warned dev-only default.

## What is deliberately absent

Socket.IO, Redis, BullMQ, email delivery, or Docker images beyond local PostgreSQL. Real-time leaderboard updates remain planned but uninstalled. Unified streaks and CPR read verified `ActivityEvent` rows only — profile fetches and rating snapshots never count as activity.
