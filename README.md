# CodePulse — Your Coding Life, Unified.

CodePulse is a unified competitive programming analytics platform. Connect coding profiles from Codeforces, LeetCode, CodeChef, GeeksforGeeks and HackerRank, view statistics in one dashboard, track combined streaks, compare contest ratings, and compete with friends in private rooms.

> **Status:** Modules 0–14 are implemented and tested: PostgreSQL + Prisma, cookie-based JWT auth, profile management, all five platform integrations, unified activity and streaks, CodePulse Rating, dashboard, historical analytics, private rooms with invitations, and global/room leaderboards. Real-time leaderboard updates (Socket.IO) are planned but not installed.

## Technology stack

Frontend:

- Next.js (App Router)
- React + TypeScript
- Tailwind CSS
- shadcn/ui pattern (`components/ui`, `lib/utils` with `cn()`)
- Centralized API client (`src/lib/api.ts`, cookie credentials)
- Recharts (dashboard charts, analytics trends, and rating history)

Backend:

- Node.js + Express.js + TypeScript
- PostgreSQL + Prisma ORM (v6)
- Zod for environment + request validation
- bcryptjs (cost 12) password hashing
- JWT session cookies (`jsonwebtoken`, HttpOnly, 24h)
- `express-rate-limit` on login/register
- `app.ts` (importable app factory) / `server.ts` (HTTP bootstrap)

Real-time:

- Socket.IO — **planned, not installed**

Testing:

- Vitest (unit tests in all workspaces)
- Supertest (backend API tests against an isolated test database)

Package management:

- npm workspaces (`frontend`, `backend`, `packages/shared`)

## Prerequisites

- Node.js >= 20
- npm >= 10
- PostgreSQL 16 (local or hosted). Easiest local option: Docker Desktop plus the one-liner below.

## PostgreSQL setup (local Docker Compose)

Prerequisites: Docker Desktop running (`docker info` should succeed).

```powershell
# from the repository root - uses compose.yaml + credentials from root .env
docker compose up -d
docker compose ps   # postgres should be "Up (healthy)"

# one-time: create the isolated test database
docker compose exec postgres psql -U codepulse -d codepulse -h /var/run/postgresql -tAc 'CREATE DATABASE codepulse_test;'
```

Useful commands (all from the repository root):

```powershell
docker compose logs postgres    # inspect server logs
docker compose stop             # stop (data kept in the codepulse_pgdata volume)
docker compose restart postgres # restart
docker compose down             # stop and remove containers (data kept)
# docker compose down -v        # DESTRUCTIVE: deletes all local data - never run casually
```

Dev database: `codepulse`. Isolated test database: `codepulse_test`. Never run the test suite against a database with real data. PostgreSQL listens on `127.0.0.1:5432` only (localhost, not the LAN). Data lives in the named `codepulse_pgdata` volume and survives restarts.

Without Docker, install PostgreSQL 16 natively (or use a hosted instance), create the same two databases, and point `DATABASE_URL` at them.

## Installation

```powershell
# from repository root
npm install
```

## Environment setup

Single source of truth: the root `.env` file (gitignored, never commit it). Both the backend runtime and `compose.yaml` read it — no passwords in committed files.

```powershell
Copy-Item .env.example .env
# then edit .env: set POSTGRES_PASSWORD, DATABASE_URL (same password),
# and JWT_SECRET (generate one: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
```

Variable precedence: shell environment > `backend/.env` > root `.env`. Exporting a variable in the shell always wins (used for pointing tests at the test database).

| Variable | Required? | Default / example | Notes |
|---|---|---|---|
| `NODE_ENV` | Yes | `development` | `development \| test \| production` |
| `PORT` | Yes | `5000` | Backend HTTP port |
| `FRONTEND_URL` | Yes | `http://localhost:3000` | Explicit CORS origin (credentials enabled, never `*`) |
| `DATABASE_URL` | Yes for DB features | `postgresql://codepulse:CHANGEME@localhost:5432/codepulse` | Backend boots without it, but auth/profile endpoints need it |
| `JWT_SECRET` | Production: yes (≥32 chars) | _(dev default with warning)_ | Signs session JWTs; startup fails in production without a strong value |
| `NEXT_PUBLIC_API_URL` | Frontend | `http://localhost:5000` | Public backend origin; set in `frontend/.env.local`. Never put secrets in `NEXT_PUBLIC_*` |
| `*_TIMEOUT_MS` | No | `10000` each | Per-platform upstream HTTP timeouts (`CODEFORCES_`, `LEETCODE_`, `CODECHEF_`, `GEEKSFORGEEKS_`, `HACKERRANK_`); see `.env.example` |

## Database commands

```powershell
# all from the repository root - root .env is loaded automatically
# (Prisma scripts via dotenv-cli, backend/db:check via the env module)
npm run db:validate  # prisma validate
npm run db:generate  # prisma generate
npm run db:migrate   # prisma migrate dev (development database only)
npm run db:check     # connectivity check (exit 1 when unreachable)

# test database (no migrate dev there) - override just the database name:
$env:DATABASE_URL='postgresql://codepulse:<password-from-.env>@localhost:5432/codepulse_test'
npm run db:deploy    # prisma migrate deploy
npm run db:studio    # prisma studio
```

Migrations live in `backend/prisma/migrations` and are applied in order. Never edit an applied migration; create a new one.

## Running the apps

```powershell
# root .env supplies DATABASE_URL automatically - no shell export needed
npm run dev:backend   # Express + tsx watch → http://localhost:5000
npm run dev:frontend  # Next dev → http://localhost:3000
npm run dev           # both concurrently
```

Health checks:

```powershell
Invoke-RestMethod http://localhost:5000/api/health
Invoke-RestMethod http://localhost:5000/api/health/db
```

## Local URLs

- Frontend: http://localhost:3000 (register: `/register`, login: `/login`, dashboard: `/dashboard`)
- Backend health: http://localhost:5000/api/health
- Backend DB health: http://localhost:5000/api/health/db

## Platform endpoints

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/api/platforms` | no | 5 platforms with `available` flags + capabilities |
| GET | `/api/platform-accounts` | cookie | Own linked accounts with latest stats |
| POST | `/api/platform-accounts/:platform/connect` | cookie (30/hour/IP) | Body `{ username }`; verifies profile first; 201; 409 if already linked |
| DELETE | `/api/platform-accounts/:platform` | cookie | Removes link + cached stats/activities/contests (user untouched); 404 if missing |
| POST | `/api/platform-accounts/:platform/sync` | cookie (20/hour/IP) | Manual refresh; 200; 409 if a sync is already running; failed refresh keeps cached data |

Platform identifiers are case-insensitive in URLs (`codeforces` works). Disconnecting deletes the linked row and cascades to its statistics, activities, and contest results; reconnecting starts a fresh import. No platform passwords are ever requested or stored.

## Supported platforms

- **Codeforces** (official public API): handle verification, current/max rating, rank, rated contests, unique solved problems (deduplicated by contest+index, OK verdicts only), contest history, submission activity (bounded pages, early-stop on known data, cap flagged via `truncated`).
- **LeetCode** (best-effort public GraphQL — undocumented, may change): profile lookup with username match check, total + Easy/Medium/Hard solved, contest rating, contests attended, recent-submission window (≤20 per-problem events, upstream-capped), full multi-year daily submission calendar (day-level counts, no problem attribution), and attended contest history with chained ratings. Streaks are never derived; missing fields stay null.
- **CodeChef** (best-effort public profile page — no official API, may change): handle verification via profile markers (bogus handles redirect away), current/max rating, division, stars, global/country ranks (null when inactive), total solved, full contest history with chained rating changes. No per-problem timestamps exist, so no activity events.
- **GeeksforGeeks** (best-effort public profile page — no official API, may change): profile verification via embedded stats object, coding **score** (labeled as score, never as rating), monthly score, total solved, institute rank, Problem-of-the-Day streaks (labeled extras; unified streak columns stay null). No contest history, no activity events.
- **HackerRank** (best-effort public profile page — no official API, may change): profile verification via embedded `viewProfiles` model, badges (stars/solved/points), per-domain practice scores, contest count, level, followers. Domain points are scores, never ratings; per-badge solved counts overlap, so no total is summed. No activity events, no contest records.

Sync behavior: synchronous (no queue), per-account in-memory lock, 10s upstream timeouts (`*_TIMEOUT_MS`, one per platform), bounded retries on transient failures only (single retry for HTML-page adapters), sanitized errors, `lastSyncedAt` updated only on success. Incremental Codeforces refreshes union new solves with stored keys so the known total never shrinks to a window count. One platform's outage never affects another's cached data.

## Activity, streaks, and rating endpoints

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/api/activity/streak` | cookie | Current/longest/total-active-days + coverage + totals; `?timezone=` override |
| GET | `/api/activity/days` | cookie | Daily buckets (`?days=1..732`, `?end=YYYY-MM-DD`, `?timezone=`); future ends clamp to today |
| GET | `/api/activity/recent` | cookie | Newest-first feed (`?limit=1..100`, `?offset=`, `?platform=`, `?type=`) with total |
| GET | `/api/rating` | cookie | Current CPR (recomputed lazily; new snapshot only on changed inputs) |
| POST | `/api/rating/recalculate` | cookie | Same as above; reports `snapshotCreated`; idempotent |
| GET | `/api/rating/history` | cookie | Snapshots newest-first (`?limit=1..100`) |

Streak policy: a calendar day in the effective timezone (query override → stored user timezone → UTC) counts with ≥1 verified activity. DST handled by the locale database. A streak stays alive when today is open and yesterday is active. Coverage distinguishes verified activity from `complete` / `partial` / `unavailable` / `never-synced` / `empty` / `error` history per platform — zeros mean "no stored events", never "no coding".

## Analytics, rooms, and leaderboard endpoints

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/api/analytics/summary` | cookie | Totals, per-platform breakdown, streak, CPR, coverage notes (`?range=7d\|30d\|90d\|1y` or `?start=&end=YYYY-MM-DD`, `?timezone=`) |
| GET | `/api/analytics/trends` | cookie | Daily/weekly/monthly buckets depending on span; same range params |
| GET | `/api/analytics/compare` | cookie | Current vs previous equal-length period; null deltas + note when history is missing |
| GET | `/api/analytics/platforms` | cookie | Per-platform rows with ratings and sync times |
| GET | `/api/analytics/contests` | cookie | Newest-first contest history (`?limit=1..100`, `?offset=`) |
| GET | `/api/analytics/ratings` | cookie | Native rating points + CPR snapshots (CPR labeled as CodePulse-defined, never official) |
| GET | `/api/rooms` | cookie | Rooms the current user belongs to |
| POST | `/api/rooms` | cookie (20/hour/IP) | Body `{ name, description? }`; creator becomes owner; 201 |
| GET/PATCH/DELETE | `/api/rooms/:id` | cookie, members only (owner for PATCH/DELETE) | Non-members get 404 (existence stays private) |
| POST | `/api/rooms/:id/leave` | cookie | Members leave; sole-owner leaving deletes the room; ownership transfers to the longest-tenured member otherwise |
| GET | `/api/rooms/:id/members` | cookie, members only | Public identity fragments only |
| DELETE | `/api/rooms/:id/members/:userId` | cookie, owner only | Owner cannot remove themselves (leave instead) |
| GET | `/api/rooms/:id/progress` | cookie, members only | Per-member CPR, streaks, solved, contests, platforms; missing values are null, never zero |
| POST | `/api/rooms/:id/invitations` | cookie, owner only (20/hour/IP) | Body `{ expiresInHours?, maxUses? }`; raw token returned once, only the hash is stored |
| GET | `/api/rooms/:id/invitations` | cookie, owner only | Invitation list without tokens |
| GET | `/api/rooms/invitations/:token/validate` | cookie (60/hour/IP) | Preview (room name, member count, expiry); generic 404 for invalid/expired/revoked/used-up tokens |
| POST | `/api/rooms/invitations/:token/accept` | cookie | Idempotent joins; exhausted tokens still succeed for existing members; 201 first join, 200 repeat |
| POST | `/api/rooms/invitations/:invitationId/revoke` | cookie, owner only | Idempotent revocation |
| GET | `/api/leaderboards/global` | no (300/hour/IP) | Opted-in users only; `?metric=cpr\|activity\|solved\|streak`, `?period=7d\|30d\|90d`, `?page=`, `?limit=1..100`; `me` resolves from session cookie when present |
| GET | `/api/leaderboards/rooms/:roomId` | cookie, members only | Same metrics scoped to room members (opt-in not required); non-members get 404 |

Leaderboard rules: competition ranking (ties share a rank, `1,2,2,4`); score → longest-streak tiebreak (streak board) → username-ascending deterministic order; CPR boards admit only current-formula snapshots; activity boards use UTC days; solved counts use platform-scoped identifiers. Global visibility defaults to hidden — users opt in via the dashboard profile checkbox (`showOnLeaderboard`).

Dashboard "Unique problems solved" chart: plots `uniqueSolvedByPlatform` — distinct `problemIdentifier` values over verified `PROBLEM_SOLVED` events per platform. Repeat accepted submissions for one problem count once; rejected submissions are never imported; contest participations are excluded. Platforms without solved rows are omitted (never zero-filled). Because imported history windows differ (e.g. Codeforces full history vs LeetCode recent window), the chart shows an "Uneven history coverage" note wherever a connected platform's history is not `complete`.

CPR is a CodePulse-defined 0–1000 score (never an official platform rating), formula `1.0.0` — see `docs/cpr-formula.md`. Components (contest 0.4 / solving 0.35 / consistency 0.25, renormalized over what's available): normalized native ratings, log-scaled solved totals, trailing-90-day activity. Disconnected platforms and missing metrics are excluded, never zeroed. Fewer than 3 components → `provisional`; none → `unavailable` (nothing persisted).

## Authentication endpoints

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | no (20/hour/IP) | 201 + sets `codepulse_session` cookie |
| POST | `/api/auth/login` | no (10/10min/IP) | 401 generic `Invalid email or password.` |
| POST | `/api/auth/logout` | no | Clears the cookie |
| GET | `/api/auth/me` | cookie | 401 when missing/invalid |
| GET | `/api/users/me` | cookie | Safe profile |
| PATCH | `/api/users/me` | cookie | `username`, `displayName`, `avatarUrl`, `timezone`, `showOnLeaderboard` (strict, 400 on anything else) |

Cookie behavior: `HttpOnly`, `SameSite=Lax`, `Secure` in production, 24h expiry, host-only/path `/`. Tokens never appear in response bodies or browser JS. Logout clears the cookie; it does not revoke the stateless JWT, so lifetimes are kept short (24h). State-changing endpoints additionally require `Origin`/`Referer` to match `FRONTEND_URL` when a browser sends them (CSRF layer; see `backend/src/middleware/csrf.ts`).

Production security requirements: strong `JWT_SECRET` (enforced at startup), `https` frontend origin in `FRONTEND_URL`, Secure cookies, `trust proxy = 1` behind the reverse proxy, PostgreSQL credentials via secret management (never committed).

## Commands

| Task | Command |
|---|---|
| Install all | `npm install` |
| Run both | `npm run dev` |
| Frontend lint | `npm run lint:frontend` |
| Backend check | `npm run lint:backend` (`tsc --noEmit`) |
| All tests | `npm test` (set `DATABASE_URL` to the **test** DB first) |
| Typecheck all | `npm run typecheck` |
| Build frontend | `npm run build:frontend` |
| Build backend | `npm run build:backend` |
| DB validate/generate/migrate/check | `npm run db:validate`, `db:generate`, `db:migrate`, `db:check` |

Backend tests must run with the test database (shell export wins over `.env`):

```powershell
$env:DATABASE_URL='postgresql://codepulse:<password-from-.env>@localhost:5432/codepulse_test'
npm run test --workspace=@codepulse/backend
```

## Troubleshooting

- `P1000` / `Can't reach database server`: PostgreSQL isn't running — `docker compose up -d` from the repo root, wait for `(healthy)` in `docker compose ps`, then `npm run db:check`.
- 503 `Database is not configured` on register/login: the backend process has no `DATABASE_URL`. Create the root `.env` from `.env.example` (see Environment setup) and restart the backend — no shell export needed for normal dev.
- `Environment variable not found: DATABASE_URL` from Prisma: the Prisma CLI resolves env vars itself — the `prisma:*` scripts load the root `.env` via dotenv-cli, so this only happens if `.env` is missing or `DATABASE_URL` is empty in it.
- Port `5432` already in use by another PostgreSQL: stop the conflicting service/container first — two servers cannot share the port. Check with `docker ps` and native services before starting compose.
- `P2002` on register: duplicate username/email → API returns 409 (expected behavior, not a bug).
- `Invalid environment configuration` for `JWT_SECRET`: production requires ≥32 chars.
- 401 on `/api/auth/me` right after login in the browser: the frontend must send `credentials: "include"` (the bundled client does) and `FRONTEND_URL` must exactly match the page origin.
- 403 `Forbidden origin.`: browser `Origin` doesn't match `FRONTEND_URL` — fix the env var, don't disable the check.
- 429 on login: rate limiter tripped (10/10min) — wait or restart the backend (in-memory counters). Same for register (20/hour), connect (30/hour), sync (20/hour), room/invitation creation (20/hour), invitation checks (60/hour), and the public leaderboard (300/hour) limiters.
- `prisma migrate dev` checksum errors: never hand-edit applied migrations; restore from version control and retry.
- `prisma migrate dev` hangs on `Enter a name for the new migration:`: answer the prompt in an interactive terminal, or (non-interactive shells) set `DATABASE_URL` in the shell and run `npx prisma migrate dev --name <migration_name>` from `backend/`. Chained `npm run db:migrate -- --name ...` does not forward flags through npm workspaces.
- Platform errors: 400 invalid/unknown handle or missing adapter; 409 already linked / sync in progress; 429 connect/sync rate limits; 502 upstream outage (cached data preserved, `lastSyncError` set, retry the sync later).

## Current implementation status (Modules 0–14)

- [x] npm workspaces + root scripts (incl. `db:*`)
- [x] Next.js welcome page (`/`) + `/register`, `/login`, `/dashboard` (profile view + edit + logout + Coding Platforms section)
- [x] Express `GET /api/health` (unchanged contract) + `GET /api/health/db`
- [x] Prisma schema: User, LinkedAccount, PlatformStats, ActivityEvent, ContestResult, RatingSnapshot, Room, RoomMember (+ migrations `20261010143048_init`, `20261010163354_add_syncing_status_and_contest_results` applied to dev and test DBs)
- [x] Auth: register/login/logout/me, bcrypt-12 hashing, JWT HttpOnly cookies, rate limits, CSRF origin check, Zod validation
- [x] Profile: `GET/PATCH /api/users/me` (self only, strict whitelist)
- [x] Platform accounts: list/connect/disconnect/manual sync with ownership enforcement, idempotent upserts, failure-preserving cache
- [x] Codeforces: official API client (profile, contests, submissions), unique-solved counting, contest history persistence
- [x] LeetCode: best-effort GraphQL adapter (profile, difficulty splits, contest rating, recent window, full daily submission calendar, attended contest history), graceful degradation, no fabricated streaks
- [x] CodeChef: best-effort profile-page adapter (rating, division, stars, ranks, solved, contest history), no activity (no timestamps exist)
- [x] GeeksforGeeks: best-effort profile-page adapter (coding score labeled as score, solved, POD streaks as labeled extras), no contests/activity
- [x] HackerRank: best-effort profile-page adapter (badges, domain scores, contest count), no summed totals, no ratings, no contests/activity
- [x] Unified activity: streaks, daily buckets, recent feed, per-platform coverage (`complete`/`partial`/`unavailable`/`never-synced`/`empty`/`error`); timezone-aware day bucketing (query → stored → UTC)
- [x] CodePulse Rating: versioned formula (`1.0.0`, see `docs/cpr-formula.md`), lazy idempotent snapshots, provisional/unavailable states, history
- [x] Dashboard: CPR card, streak card, 12-month heatmap, Recharts analytics, recent feed, platform overview, profile editing — all from live APIs with loading/error/empty states
- [x] Shared package: `SafeUser`, auth + platform + activity + rating + analytics + rooms + leaderboard DTO contracts
- [x] Historical analytics: `/analytics` page (range presets + custom ranges, trends, platform breakdown, period comparison, CPR/native rating history, contest history) backed by authenticated `/api/analytics/*` endpoints over verified persisted data, with honest empty/partial-history states
- [x] Private rooms: `/rooms`, `/rooms/[id]`, `/invite/[token]` pages; ownership transfer and deletion rules; SHA-256-hashed single-/multi-use invitations with expiry and revocation; member progress views
- [x] Leaderboards: `/leaderboards` page plus room boards; CPR/activity/solved/streak metrics; competition ranking with deterministic tiebreaks; pagination; `showOnLeaderboard` opt-in (dashboard checkbox, hidden by default); room membership enforcement
- [x] 223 backend tests passing across 19 files (live upstream tests skip without `LIVE_API=1`) + 72 frontend tests + 2 shared tests
- [x] Docker Compose PostgreSQL (`compose.yaml`, localhost-only, named volume, healthcheck) with root `.env` as the single credential source

## Planned module roadmap

1. ~~Auth + users + JWT + PostgreSQL/Prisma setup~~ (done)
2. ~~Platform profile connections (CF + LeetCode) + statistics ingestion~~ (done)
3. ~~CodeChef / GeeksforGeeks / HackerRank integrations~~ (done)
4. ~~Streaks, CPR rating, activity/rating history~~ (done)
5. ~~Rooms APIs, invitation codes, leaderboards~~ (done — Module 13 rooms/invitations, Module 14 global + room leaderboards)
6. Real-time leaderboard updates (Socket.IO) — planned, not installed
7. ~~Analytics dashboards (Recharts)~~ (done — Module 12 analytics page + endpoints)

See `docs/architecture.md` and `docs/development-guide.md`.
