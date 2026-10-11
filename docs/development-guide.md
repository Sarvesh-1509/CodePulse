# CodePulse Development Guide (Modules 0–14)

## Adding a future module without tight coupling

1. **Scope the domain first.** Each module owns one directory:
   - Backend: `backend/src/modules/<domain>/` (routes, service, schema, tests).
   - Frontend: `frontend/src/app/<route>/` + `frontend/src/components/<domain>/`.
   - Contracts: `packages/shared/src/<domain>.ts`.
2. **Contract first.** Add request/response Zod schemas and TypeScript types to `@codepulse/shared`, then import them on both sides. Never duplicate the same shape in two places.
3. **Keep `app.ts` thin.** Register the new router in `app.ts` (e.g. `app.use("/api/rooms", roomsRouter)`). Put business logic in the module service, not in middleware or `server.ts`.
4. **Validate at the boundary.** Use Zod middleware for every new request body/query/param. Reject unknown fields where sensible.
5. **Test alongside.** Each backend module ships `tests/<domain>.test.ts` (Supertest). Each shared helper ships `src/<domain>.test.ts` (Vitest). Frontend interactive logic ships `*.test.ts(x)`. Run `npm test` from the root before opening a PR.
6. **No cross-module imports.** `modules/rooms` must not import from `modules/ratings`. Share code by moving it to `backend/src/utils/` or `@codepulse/shared`.
7. **Config changes.** New required env vars go into `backend/src/config/env.ts` (Zod) **and** `.env.example` with a `REQUIRED NOW` vs `RESERVED` note. Never commit `.env`.
8. **Database changes.** Prisma schema + migrations live in `backend/prisma/`. Modules must go through `src/db/prisma.ts` (the singleton client), never raw connection strings. Never edit an applied migration — always add a new one via `npm run db:migrate`.

## Daily commands (Windows / macOS / Linux)

```powershell
npm install          # install all workspaces
npm run dev          # frontend + backend concurrently
npm run dev:frontend # Next.js only
npm run dev:backend  # Express + tsx watch only
npm test             # all workspace tests (point DATABASE_URL at the TEST db first)
npm run typecheck    # all workspace tsc --noEmit
npm run lint         # frontend eslint + backend tsc check
```

## Database workflow

Start PostgreSQL first (repo root): `docker compose up -d`, then confirm `(healthy)` via `docker compose ps`. The test database is created once with `docker compose exec postgres psql -U codepulse -d codepulse -h /var/run/postgresql -tAc 'CREATE DATABASE codepulse_test;'`.

```powershell
# root .env is loaded automatically - no shell export needed for these:
npm run db:validate  # prisma validate — run after every schema edit
npm run db:generate  # regenerate Prisma Client after schema edits
npm run db:migrate   # prisma migrate dev — creates + applies a migration (dev only)
npm run db:check     # SELECT 1 connectivity check, safe for CI gates
npm run db:deploy    # prisma migrate deploy — test/prod databases
npm run db:studio    # visual data browser (dev only, never expose publicly)
```

Rules:

- Single credential source: root `.env` (read by `compose.yaml`, the backend env module, `db:check`, and the `prisma:*` scripts via dotenv-cli). Never commit it; never duplicate values into `backend/.env`.
- Precedence: shell environment > `backend/.env` > root `.env`. Use a shell export only to override (e.g. pointing tests at `codepulse_test`).
- The backend boots without `DATABASE_URL` but DB endpoints fail with a clear 503 instead of pretending.
- Backend tests run **only** against `codepulse_test`:
  ```powershell
  $env:DATABASE_URL='postgresql://codepulse:<password-from-.env>@localhost:5432/codepulse_test'
  npm run test --workspace=@codepulse/backend
  ```
- Test files create uniquely-suffixed users and delete them in `afterAll`. No truncates, no destructive operations. Never `migrate reset`, `down -v`, or `db push` on a database with real data.
- `prisma migrate dev` prompts for a migration name; answer it in an interactive terminal, or (non-interactive shells) export `DATABASE_URL` and run `npx prisma migrate dev --name <migration_name>` from `backend/`. Do not rely on flag forwarding through chained npm workspace scripts.
- Live upstream smoke tests live in `backend/tests/live.test.ts` and are skipped unless `LIVE_API=1` is set. Unit tests must never depend on third-party availability — mock fetch/adapters instead.

## Platform conventions (Modules 3–8 — follow these for new integrations)

- Register the platform in `modules/platforms/registry.ts` (id, display name, capabilities, availability, username rules). No platform-specific conditionals elsewhere. Capabilities must reflect reality: omit `activity`/`contests` when the source exposes none, so the frontend hides those sections.
- Implement the `PlatformAdapter` interface (`fetchAll` returns a normalized `SyncBundle`; throws `PlatformError`). Keep all HTTP in the adapter; all writes in `modules/platforms/service.ts`.
- New integrations are exercised through `createApp({ platformAdapters })` injection in tests — never hit real APIs from unit tests. Swap `globalThis.fetch` via `withFetchStub` (platforms/http) for client-level tests.
- Upstream URLs are fixed constants; usernames travel as encoded params/bodies only (SSRF guard). Timeouts on every request (`*_TIMEOUT_MS` env, documented in `.env.example`); bounded retries for transient failures (single retry for plain-HTML sources); Zod-validate every external response.
- Missing data stays null (never zero, never fabricated). Scores are not ratings and solved-counts are not summed across overlapping categories — keep them labeled in `extra`. Record sync failures as short sanitized strings in `lastSyncError`; never overwrite `lastSyncedAt` on failure.
- Disconnect deletes the linked row; cascades clear stats/activities/contests. Document any policy change here and in the README.
- Best-effort HTML adapters: verify via page-specific existence signals (redirect targets, embedded data objects), fail closed on drift, document the source as unofficial in the module header.

## Activity and rating conventions (Modules 9–11)

- Only verified `ActivityEvent` rows count as activity. Never derive events from profile fetches, rating snapshots, sync timestamps, or aggregate totals.
- Day-bucketing and streak math live in `src/utils/streaks.ts` (pure, deterministic, unit-tested) so `modules/activity` and `modules/rating` share them without cross-module imports.
- Effective timezone is always query override → stored user timezone → UTC, echoed back in every response. Compute day keys with `Intl` in that zone; never persist a baked-in date.
- Missing history is data, not zero: surface it through coverage states (`complete`/`partial`/`unavailable`/`never-synced`/`empty`/`error`), never by inventing days.
- CPR formula changes require a semver bump of `FORMULA_VERSION`, a new `docs/cpr-formula.md` section, and tests. Snapshots are immutable history; recalculation inserts only when the inputs hash changes.

## Auth conventions (Module 2 — follow these for new protected routes)

- Protect routes with `requireAuth` from `modules/auth/middleware.ts`. It verifies the `codepulse_session` JWT, reloads the user from the DB, and sets `req.authUser` (typed via declaration merging). Never trust ids sent by the frontend.
- Serialize users with `toSafeUser()` — `passwordHash` must never cross the API boundary.
- State-changing routers sit behind `requireSameOrigin` (`middleware/csrf.ts`) plus the app-level CORS `{ origin: FRONTEND_URL, credentials: true }`.
- New login-adjacent endpoints get an `express-rate-limit` instance from a factory (fresh per `createApp()`, never a shared singleton) so tests stay isolated.
- Passwords: bcrypt-12 via `modules/auth/password.ts`. Enforce the 12-char minimum and 72-byte cap at the Zod layer.
- Frontend: use `src/lib/api.ts` (`credentials: "include"`). Never store tokens in localStorage/sessionStorage — there are no tokens to store.

## Conventions

- TypeScript `strict: true` everywhere.
- Backend responses use the shared shape `{ success, message, data?, timestamp? }`.
- Frontend styling: Tailwind utilities + `cn()` from `src/lib/utils.ts`; prefer existing `components/ui/*` primitives over ad-hoc buttons.
- Dark developer-focused aesthetic: restrained accents (`cyan-300` on `#0a0f14`), subtle `border-border` surfaces, accessible contrast. Avoid heavy gradients and glow.
- Keep `server.ts` to bootstrapping only so `createApp()` stays testable.
