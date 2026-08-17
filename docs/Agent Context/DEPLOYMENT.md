# Deployment

## Status: mostly undocumented

There is **no Dockerfile, docker-compose file, or CI/CD config** (`.github/workflows` or
otherwise) anywhere in this repository. There is no deploy script under `/scripts` or
`backend/scripts` either — those directories hold one-off maintenance utilities (email
previews, an analytics-character fixup), not deployment tooling. Everything below documents
what *can* be inferred from `package.json` scripts and the platform config; the actual
target environment (host, process manager, reverse proxy, database hosting) is **Unknown /
needs confirmation**.

## Environments

The code recognizes exactly one environment switch: `NODE_ENV`, read in
`backend/src/platform/config.js`. `NODE_ENV=production` is the only branch with distinct
behavior (see below). There's no staging-specific code path — "staging" would just be a
non-production deployment with its own env vars.

## Build & start

Two independently deployable apps, run from the workspace root or their own directory.

| App | Dev | Build | Start | Test |
|---|---|---|---|---|
| backend | `npm run dev:backend` (root) or `npm run dev` (in `backend/`) — `node --watch` | none (plain Node ESM, no build step) | `npm start` (in `backend/`) → `node src/index.js` | `npm test` (in `backend/`) — Node's built-in test runner |
| frontend | `npm run dev` (root, defaults to frontend) or `npm run dev` (in `frontend/`) — `next dev -p 3002` | `npm run build` (in `frontend/`) → `next build` | `npm start` (in `frontend/`) → `next start` | `npm test` (in `frontend/`) — Vitest |

Root-level `npm test` runs `npm test --workspaces --if-present`, i.e. both apps' test
suites in one pass.

The backend has no build step — it ships as plain ESM and runs directly with `node`. The
frontend requires `next build` before `next start` in a production-style run.

## Environment variables

Two separate env files, deliberately not shared — `backend/src/platform/loadEnv.js` carries
a comment noting a single root `.env` previously let a backend `PORT`/`NODE_ENV` bleed into
the Next build, so the split is intentional, not an oversight.

- `backend/.env` (see `backend/.env.example`) — loaded by `loadEnv.js` via `dotenv`.
- `frontend/.env` (see `frontend/.env.example`) — loaded natively by Next; nothing in
  `backend/.env` reaches it and vice versa.

**Backend**, from `backend/src/platform/config.js`:

Required (boot fails without them): `MONGODB_URL`, `JWT_SECRET`, `FRONTEND_BASE_URL`,
`CORS_ORIGINS`.

Optional, with defaults: `NODE_ENV` (`development`), `PORT` (`4000`), `COOKIE_DOMAIN`
(unset), `JWT_ACCESS_EXPIRATION_MINUTES` (`15`), `JWT_REFRESH_EXPIRATION_DAYS` (`30`),
`LOG_LEVEL` (`info`, read directly in `platform/logger.js`).

Capability groups — all-or-nothing; a partial group throws a config error at boot:
- **storage** (enables attachments): `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
  `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET` (or its alias `AWS_S3_BUCKET_NAME`).
- **email** (enables invite/notification mail): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`,
  `SMTP_PASSWORD`, `EMAIL_FROM`; optional `SMTP_TLS_REJECT_UNAUTHORIZED` (default `true`).
- **seed** (first-boot admin account): `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`.

In production (`NODE_ENV=production`), `config.js` additionally refuses to boot if
`JWT_SECRET` is under 32 characters or matches a known placeholder string
(`changeme`, `secret`, `test`, etc.), and applies the same placeholder check to
`SEED_ADMIN_PASSWORD` if set.

**Frontend**, from `frontend/shared/lib/env.js`: `NEXT_PUBLIC_API_URL`, required with no
fallback — a missing value throws rather than silently resolving to a same-origin path that
would 404 in production. `NODE_ENV` and `PORT` are deliberately **not** read from
`frontend/.env` (Next sets `NODE_ENV` per command; `PORT` must come from the shell, e.g.
`PORT=3002 npm start`).

No root-level `.env` or `.env.example` exists, and none should be added — see the ADR on
the split-env decision in `ADR.md`. Use `backend/.env.example` and `frontend/.env.example`
as the source of truth for required variables.

## Database

MongoDB, connected via `MONGODB_URL` (`backend/src/platform/db.js`). No migration tooling
is present — `backend/src/seed.js` creates the first admin account (via the `seed`
capability group) but that's account bootstrapping, not schema migration. Mongoose applies
schema/index definitions on connect; there's no separate migration step to run.

## Monitoring / health checks

`GET /health` — liveness (process is up). `GET /ready` — readiness (process can serve
requests; checks `isDbReady()`, returns 503 if the database isn't ready). No metrics
endpoint, APM, or external monitoring integration found in the repo.

## Logging

`winston`, configured in `backend/src/platform/logger.js`, level from `LOG_LEVEL` (default
`info`). Morgan HTTP request logging is enabled in `app.js` for all environments except
`test`. No log shipping / aggregation config found — **Unknown / needs confirmation**
whether logs are captured by a hosting platform or shipped elsewhere in production.

## What's missing

- Dockerfile / container image definition
- CI pipeline (test-on-PR, build, deploy)
- A named hosting target (Vercel is referenced only as build-tool env vars picked up
  transitively by Next's own tooling — that is not evidence this app deploys there)
- Migration/rollback strategy for schema changes
- Secrets management (env vars are assumed to be provided by whatever runs the process;
  no vault/secrets-manager integration in code)
