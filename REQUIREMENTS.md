# CodePulse — Functional & Non-Functional Requirements

> Derived from actual code: `README.md`, `docs/architecture.md`, `docs/cpr-formula.md`, `docs/development-guide.md`, `backend/prisma/schema.prisma`, `backend/src/app.ts`, `backend/src/config/env.ts`, `backend/src/modules/*/routes.ts`, `schemas.ts`, `service.ts`, `frontend/src/app/*`, `frontend/src/lib/api.ts`, `packages/shared/src/*`.
> Labels: **Verified** = in code/docs, **Inferred** = reasonable reading, **Missing** = not found.

---

## A. Functional Requirements

### FR-1 Authentication
- **FR-1.1** Register with `username (3-30, A-Za-z0-9_-)`, `email`, `password (12-128 chars, ≤72 bytes)`, optional `displayName (1-50)` — **Verified** `backend/src/modules/auth/schemas.ts:31-43`. Strict, rejects extras. `201 + cookie` — `routes.ts:16-42`.
- **FR-1.2** Login with `email + password` (any non-empty), generic `401 Invalid email or password.` for unknown + wrong — **Verified** `schemas.ts:45-52`, `service.ts:52-65`.
- **FR-1.3** Logout clears `codepulse_session` cookie — **Verified** `routes.ts:72-75`.
- **FR-1.4** `GET /auth/me` returns current `SafeUser` (no passwordHash) or 401 — **Verified** `routes.ts:77-83`, `serialize.ts`.
- **FR-1.5** Rate limits: register 20/hour, login 10/10min per IP — **Verified** `auth/rateLimit.ts:13-41`.

### FR-2 Profile
- **FR-2.1** `GET /users/me` returns own safe profile — **Verified** `users/routes.ts`.
- **FR-2.2** `PATCH /users/me` edits only `username, displayName, avatarUrl, timezone (IANA), showOnLeaderboard`, ≥1 key, strict — **Verified** `users/schemas.ts`, `service.ts`. Duplicate username → 409.
- **FR-2.3** Email/password change not supported in UI — **Verified** `frontend/src/app/dashboard/page.tsx:353-354`.

### FR-3 Platforms (5 integrations)
- **FR-3.1** `GET /platforms` public metadata with `available` flags + capabilities — **Verified** `platforms/routes.ts:19-31`, `registry.ts:27-63`.
  - CODEFORCES/LEETCODE: profile, stats, activity, contests, sync. CODECHEF: +contests no activity. GFG/HR: profile, stats, sync only.
- **FR-3.2** `GET /platform-accounts` lists own links + latest stats — **Verified** `:48-59`.
- **FR-3.3** `POST /:platform/connect {username}` verifies upstream first, creates `LinkedAccount CONNECTED` + imports stats/activities/contests in one transaction, `201`, `409` if linked, `400` unknown handle, `429` 30/hour, `502` on outage — **Verified** `:61-101`, `service.ts:347-398`.
- **FR-3.4** `DELETE /:platform` removes link + cascades stats/activities/contests, user untouched, `404` if missing — **Verified** `:103-123`, `service.ts:402-417`.
- **FR-3.5** `POST /:platform/sync` manual refresh, `200`, `409` if in-flight (in-memory lock), `429` 20/hour, failed refresh keeps cache + sets `ERROR/lastSyncError` — **Verified** `:125-151`, `service.ts:456-527`.
- **FR-3.6** Platform IDs case-insensitive; no platform passwords stored — **Verified** `schemas.ts:12-17`, `README.md:153`.
- **FR-3.7** Per-platform rules: CF unique OK solves `cf-*` + contest history; LC recent window `lc-*` + calendar `DailyActivity` + chained contests, no fabricated streaks; CC rating/contests no activities; GFG score (not rating) + POD extras; HR badges/domains, no summed totals, scores not ratings — **Verified** `codeforces/service.ts`, `leetcode/service.ts`, `codechef/service.ts`, `geeksforgeeks/service.ts`, `hackerrank/service.ts`.

### FR-4 Activity & Streaks
- **FR-4.1** `GET /activity/streak?timezone=` returns current/longest/total-active-days + coverage + totals — **Verified** `activity/routes.ts:26-47`.
- **FR-4.2** `GET /activity/days?days(1-732)&end(YYYY-MM-DD)&timezone=` daily buckets, future end clamps to today — **Verified** `:49-71`.
- **FR-4.3** `GET /activity/recent?limit(1-100)&offset&platform&type=` newest-first feed + total — **Verified** `:73-95`.
- **FR-4.4** Day counts with ≥1 verified event in effective tz (query → stored → UTC), DST via locale DB; today-open keeps streak alive — **Verified** `README.md:176`, `utils/streaks.ts`.
- **FR-4.5** Coverage `complete/partial/unavailable/never-synced/empty/error`; zeros = no stored events, never no coding — **Verified** `activity/service.ts`.

### FR-5 CodePulse Rating (CPR v1.0.0)
- **FR-5.1** `GET /rating` lazy recompute, new snapshot only on changed inputs; `POST /rating/recalculate` idempotent with `snapshotCreated` flag; `GET /rating/history?limit(1-100)` newest-first — **Verified** `rating/routes.ts:31-67`, `service.ts:213-270`.
- **FR-5.2** 0–1000 CodePulse-defined (never official), contest 0.4 / solving 0.35 / consistency 0.25 renormalised; ceilings CF 4000/LC 3500/CC 4000; log solving; 90-day consistency; <3 components → provisional, 0 → unavailable (nothing persisted) — **Verified** `docs/cpr-formula.md:20-77`.
- **FR-5.3** Disconnected/missing excluded never zeroed; GFG scores/HR points never enter rating — **Verified** `cpr-formula.md:16-18,67`.

### FR-6 Analytics
- **FR-6.1** `GET /analytics/summary|trends|compare|platforms` with `range=7d|30d|90d|1y` XOR `start&end (≤366d, start≤end, end≤today)` + `timezone` — **Verified** `analytics/schemas.ts`, `service.ts:251-324`.
- **FR-6.2** Trends buckets daily ≤31d / weekly ≤120d / monthly else — **Verified** `service.ts`.
- **FR-6.3** Compare current vs equal previous, null deltas + note when missing — **Verified** `:379-402`.
- **FR-6.4** `GET /analytics/contests?limit&offset` newest-first; `GET /analytics/ratings` native (cap 500) + CPR — **Verified** `:449-498`.
- **FR-6.5** Honest empty/partial-history states, never invented days — **Verified** `README.md:205`.

### FR-7 Rooms & Invitations
- **FR-7.1** `GET /rooms` own rooms; `POST /rooms {name 1-60, description? ≤500}` creator = owner, `201`, 20/hour — **Verified** `rooms/routes.ts:58-79`.
- **FR-7.2** `GET/PATCH/DELETE /rooms/:id` members-only (non-member 404), patch/delete owner-only — **Verified** `:155-191`.
- **FR-7.3** `POST /:id/leave`: members leave; sole-owner deletes room; else transfers to longest-tenured — **Verified** `:193-210`, `service.ts:216-244`.
- **FR-7.4** `GET /:id/members` members-only public fragments; `DELETE /:id/members/:userId` owner-only, not self — **Verified** `:212-248`.
- **FR-7.5** `GET /:id/progress` per-member CPR/streak/solved/contests/platforms, nulls never zero — **Verified** `:226-235`, `service.ts:614-648`.
- **FR-7.6** `POST /:id/invitations {expiresInHours 1-720, maxUses 1-100, username?}` owner-only 20/hour; raw token once + hash stored; `GET /:id/invitations` owner list w/o tokens; `GET /invitations/:token/validate` 60/hour preview + generic 404; `POST /invitations/:token/accept` idempotent (201 first, 200 repeat); `POST /invitations/:id/revoke` idempotent owner; in-app `received` list/accept/decline by id — **Verified** `:83-153,250-275`, `service.ts:277-567`.
- **FR-7.7** Max 100 members per room — **Verified** `service.ts`.

### FR-8 Leaderboards
- **FR-8.1** `GET /leaderboards/global?metric(cpr|activity|solved|streak)&period(7d|30d|90d)&page&limit(1-100)` public 300/hour, only `showOnLeaderboard=true`, `me` from optional cookie — **Verified** `leaderboards/routes.ts:25-41`.
- **FR-8.2** `GET /leaderboards/rooms/:roomId?...` cookie + members-only (404 else), no opt-in needed — **Verified** `:43-70`.
- **FR-8.3** Competition rank `1,2,2,4`; score → longest-streak → username tiebreak; CPR only current formula; activity UTC days; solved platform-scoped — **Verified** `README.md:203`, `service.ts`.
- **FR-8.4** Global default hidden, opt-in via dashboard checkbox — **Verified** `dashboard/page.tsx:373-390`, `schema.prisma:67`.

### FR-9 Frontend Pages
- **FR-9.1** `/` welcome + features; `/register`, `/login`, `/dashboard` (CPR, streak, 12-month heatmap, Recharts, recent, platforms, profile edit + logout), `/contributions` (selected-period verified activity heatmap, streak summary, comparison, platform breakdown, deterministic insights, coverage, recent feed), `/analytics` (presets + custom, trends, breakdown, compare, CPR/native, contests), `/rooms`, `/rooms/[id]`, `/invite/[token]`, `/leaderboards` (+room boards) — all with loading/error/empty states, 401 → `/login` — **Verified** `frontend/src/app/*/page.tsx`, `dashboard/page.tsx:77-86,173-181`.
- **FR-9.2** Central client `lib/api.ts` with `credentials:include`, `ApiError{status,message,issues}`, `NEXT_PUBLIC_API_URL` — **Verified** `api.ts:41-80`.

### FR-10 Health
- **FR-10.1** `GET /api/health` always up `{success,message,timestamp}`; `GET /api/health/db` `{database,latencyMs}` 200/503, never leaks connection/SQL — **Verified** `routes/health.ts:7-35`.

---

## B. Non-Functional Requirements

### NFR-1 Performance
- **NFR-1.1** Upstream timeouts 10s each (`*_TIMEOUT_MS`) — **Verified** `config/env.ts:44-48`.
- **NFR-1.2** CF paging bounded (1000/page, 10 pages, 350ms delay, early-stop, `truncated` flag); LC 3 sequential bounded GraphQL + recent ≤20; HTML single retry — **Verified** `codeforces/client.ts`, `leetcode/client.ts:346-369`, `codechef/client.ts:97`, others.
- **NFR-1.3** Persist chunked 1000, short transactions after fetch; reads aggregate stored rows, syncs never block loads — **Verified** `platforms/service.ts:160,235-302`, `docs/architecture.md:81`.
- **NFR-1.4** Leaderboard caps `take 4000` snapshots / `200k` events, pagination `limit 1-100` — **Verified** `leaderboards/service.ts`. **Inferred** need for materialization at >1k users.

### NFR-2 Reliability & Consistency
- **NFR-2.1** Verify-before-create; failed verify creates nothing; failed sync preserves stats/`lastSyncedAt` + sets `ERROR/sanitized lastSyncError≤300` — **Verified** `service.ts:366-373,491-498,450-454`.
- **NFR-2.2** Idempotency: `skipDuplicates`, `upsert` (stats overwrite never sum, daily overwrite), `@@unique` guards, `syncLocks` 409, CPR hash check, invite idempotent joins — **Verified** `service.ts:196-330,425,471-525`, `rating/service.ts:213-258`, `rooms/service.ts:430-567`.
- **NFR-2.3** Incremental CF union prevents shrink; null-preserving upserts (unknown≠zero); `SUBMISSION` cleanup only on `complete` days — **Verified** `:171-194,215-229,314-329`.
- **NFR-2.4** One platform outage never clears another's cache — **Verified** per-account try/catch.
- **NFR-2.5** All FKs cascade, no orphans; migrations ordered, never edit applied — **Verified** `schema.prisma`, `development-guide.md:38`.
- **NFR-2.6** `syncLocks` single-instance only — **Verified** limitation, needs DB lock for multi-instance (**Inferred** gap).

### NFR-3 Security
- **NFR-3.1** bcrypt-12, 12-char/72-byte password rule (bcrypt truncates past 72B) — **Verified** `auth/password.ts`, `schemas.ts:14-22`.
- **NFR-3.2** HS256 JWT 24h in `HttpOnly, SameSite=Lax, Secure-in-prod, host-only, path=/` cookie; never in body/JS/storage; logout clears but doesn't revoke (24h window) — **Verified** `tokens.ts`, `cookies.ts`.
- **NFR-3.3** `requireAuth` reloads DB every request; generic 401s; `toSafeUser` strips hash; room progress/members expose fragments only; invite list omits tokens — **Verified** `middleware.ts`, `serialize.ts`, `rooms/service.ts`.
- **NFR-3.4** CORS explicit `FRONTEND_URL` + credentials never `*`; `trust proxy=1` (single proxy); `requireSameOrigin` CSRF on state-changing (403 on mismatch, allows no-Origin curl/tests) + JSON preflight — **Verified** `app.ts:33-45`, `middleware/csrf.ts`.
- **NFR-3.5** 7 rate limiters (see FR) with fresh instances per app for test isolation — **Verified** `rateLimit.ts`.
- **NFR-3.6** Zod strict everywhere + `issues`; `HttpError` central (4xx passthrough, 500 generic in prod, no stack/SQL/secrets); Prisma parameterized + `Prisma.sql` (no concat) — **Verified** `errorHandler.ts`, `httpError.ts`.
- **NFR-3.7** `JWT_SECRET` ≥32 in prod else startup fail; dev fallback warns; `DATABASE_URL` 503 fail-fast; `NEXT_PUBLIC_*` never secrets; invite raw-once + SHA-256 hash; no platform passwords — **Verified** `env.ts:50-94`, `prisma.ts:24-32`, `schema.prisma:231-235`.
- **NFR-3.8** Rooms 404 for non-members (privacy); invites generic 404; global board opt-in hidden-by-default — **Verified** `rooms/service.ts`, `leaderboards/routes.ts`.

### NFR-4 Usability
- **NFR-4.1** Dark dev aesthetic, Tailwind + `cn()` + `ui/` primitives, `cyan-300 on #0a0f14`, accessible contrast, no heavy gradients — **Verified** `development-guide.md:88-89`, `dashboard/page.tsx`.
- **NFR-4.2** Per-section loading/error/empty/retry; parallel fetches so one failure never blocks dashboard; honest `Uneven history coverage`, `provisional/unavailable` labels; CPR never presented as official — **Verified** `dashboard/page.tsx:173-181,293-349`, `cpr-formula.md:3-5`.
- **NFR-4.3** Forms show `issues` field errors; toasts for profile save; `Cannot reach API` when backend down — **Verified** `api.ts:65`, `auth/routes.ts:22-28`.

### NFR-5 Maintainability
- **NFR-5.1** TS `strict:true`; factory routers; `server.ts` bootstrap-only; `app.ts` thin; no cross-module imports (share via `utils/` or `@codepulse/shared`); contract-first DTOs; acyclic shared — **Verified** `development-guide.md:1-15,86`, `architecture.md:57-61`.
- **NFR-5.2** Single `.env` source, precedence shell > `backend/.env` > root; `prisma:*` via dotenv-cli; `db:validate/generate/migrate/check/deploy/studio` scripts — **Verified** `env.ts:6-23`, `package.json`.
- **NFR-5.3** Tests: 19 backend (Supertest isolated test DB, `LIVE_API=1` gates live), 72 frontend + 2 shared (Vitest); mocks via `createApp({adapters})` + `withFetchStub`; uniquely-suffixed users + `afterAll` cleanup — **Verified** `README.md:281`, `development-guide.md:48-55`, `platforms/http.ts:116-127`.
- **NFR-5.4** Typecheck all, eslint frontend, `tsc --noEmit` backend — **Verified** `package.json`.

### NFR-6 Portability & Deployment
- **NFR-6.1** Node ≥20, npm ≥10; `concurrently` dev both; `:3000` frontend, `:5000` backend; compose Postgres `127.0.0.1:5432` localhost-only + `codepulse_pgdata` volume + healthcheck — **Verified** `package.json:36-39`, `compose.yaml:17-44`.
- **NFR-6.2** No Dockerfile/CI/hosting in repo; Socket.IO/Redis/BullMQ/email absent (real-time planned not installed) — **Verified absent** `architecture.md:93-95`.
- **NFR-6.3** Prod requires strong `JWT_SECRET`, `https FRONTEND_URL`, Secure cookies, secret-managed DB creds — **Verified** `README.md:222`.

### NFR-7 Data Honesty (project-specific)
- Missing stays `null` never zero/fabricated; scores ≠ ratings; badge counts never summed; unknown history not scored; coverage travels with every response — **Verified** `schema.prisma:110-111` comment, `development-guide.md:63,69-73`, `cpr-formula.md:58-67`.

---

## Traceability (sample)

| Req | Code |
|---|---|
| FR-1/2 | `backend/src/modules/auth/*`, `users/*`, `frontend/src/app/register|login|dashboard/*` |
| FR-3 | `platforms/routes.ts+service.ts+registry.ts`, `{codeforces,leetcode,codechef,geeksforgeeks,hackerrank}/*`, `components/platform-accounts.tsx` |
| FR-4/5/6 | `activity/*`, `rating/*+formula.ts`, `analytics/*`, `utils/activity.ts+streaks.ts`, `cpr-card|streak-card|activity-heatmap|analytics-charts` |
| FR-7/8 | `rooms/*`, `leaderboards/*`, `app/rooms|invite|leaderboards/*` |
| FR-9/10 | `frontend/src/lib/api.ts`, `app/page.tsx+layout.tsx`, `backend/src/routes/health.ts` |
| NFR | `config/env.ts`, `db/prisma.ts`, `middleware/*`, `utils/httpError.ts`, `compose.yaml`, `.env.example` |

*No secrets included. Env names only. Gaps marked Missing/Unknown in §16 of PROJECT_ANALYSIS.md.*
