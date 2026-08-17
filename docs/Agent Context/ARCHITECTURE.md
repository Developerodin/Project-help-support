# Architecture

PROWPLUS is a small PMS (projects/teams/tickets/users) monorepo: an Express API and a
Next.js frontend, sharing one framework-free package of constants/enums/email templates.
It originated as a Dharwin-specific tool and is mid-transition toward a general-purpose,
multi-client PMS — see [`PROJECT_MODEL.md`](./PROJECT_MODEL.md) and
[`PRODUCT_PRINCIPLES.md`](./PRODUCT_PRINCIPLES.md) for what "general-purpose" means here and
how far the migration has actually gotten.

## 1. Technology stack

| Layer | Choice | Notes |
|---|---|---|
| Backend runtime | Node.js ≥20, ESM (`"type": "module"`) | no TypeScript, no build step |
| Backend framework | Express 4 | |
| Database | MongoDB via Mongoose 8 | |
| Auth | JWT access token + httpOnly refresh cookie | `jsonwebtoken`, `bcryptjs` |
| Validation | Joi | one `.validation.js` per module |
| Backend tests | Node's built-in `node --test` + `mongodb-memory-server` + `supertest` | |
| Frontend framework | Next.js 15 (App Router), React 19 | |
| Frontend styling | `design-system.css` (global, unlayered CSS) as the default system; Tailwind 4 present but only used on a couple of newer surfaces — see [`DESIGN.md`](./DESIGN.md) | |
| Frontend data fetching | Plain `fetch` via `shared/api/*.js` wrappers + component state; SWR used only for notification polling | |
| Frontend tests | Vitest + Testing Library, jsdom | |
| Charts / 3D / motion | apexcharts, three.js, animejs — used selectively, not globally | |
| Email | Nodemailer, templates in `shared/email/` | capability-gated, see §7 |
| File storage | AWS S3 (`@aws-sdk/client-s3`) | capability-gated, see §7 |
| Monorepo tooling | npm workspaces (no Turborepo/Nx) | |

## 2. Repository layout

```
backend/    Express API — see §3
frontend/   Next.js App Router UI — see §4
shared/     @pms/shared — enums, stages, notification events, module taxonomy, email templates
scripts/    one-off maintenance scripts, not part of the running app
docs/       this documentation set
```

Root `package.json` declares workspaces `["shared", "backend", "frontend"]`. Both apps
depend on `@pms/shared` via workspace link (`"@pms/shared": "*"`) — a constant, enum, or
email template that already lives there must never be duplicated locally.

Root scripts: `npm run dev` (frontend, port 3002), `npm run dev:backend` (port 4000 by
default), `npm test` (all workspaces), `npm run lint`.

## 3. Backend architecture (`backend/src`)

### Module-per-vertical-slice

Domain code is organized as **modules**, not horizontal layers. Each module in
`modules/<name>/` owns model, route, controller, service, and validation together:

```
<name>.model.js       Mongoose schema
<name>.route.js       Express router — wires validation + controller
<name>.controller.js  HTTP glue (req/res), delegates to service
<name>.service.js     business logic, queries
<name>.validation.js  Joi request schemas
```

Modules today: `auth`, `teams`, `projects`, `tickets` (+ `analytics.route.js` for ticket
aggregates), `users`, `notifications` (also owns `dispatch.js`, `email.service.js`,
`emailLog.model.js`, `recipients.js` — the notification module is the one place that's
grown beyond the five-file shape, since it fans out to multiple delivery channels).

Cross-cutting infrastructure lives in `platform/` and is imported by modules — never the
reverse: `config.js`, `db.js`, `auth.js` (JWT verify + auth middleware), `errors.js`
(`ApiError` + converter/handler), `rateLimit.js`, `requestId.js`, `sameOrigin.js`,
`paginate.js`, `validate.js` (Joi wiring), `upload.js`, `s3.js`, `mailer.js`, `logger.js`
(winston), `toJSON.plugin.js` (Mongoose serialization — strips `__v`, remaps `_id`→`id`,
drops fields marked `private`/`select: false`).

A module reaching into another module's model/service directly (bypassing its public
service functions) would break this boundary; `tickets` importing the `Team` model for
aggregate stats (see `team.service.js`) is the one intentional cross-module read, done via
Mongoose aggregation rather than the ticket service's internals.

### Request lifecycle

```
Client
  │
  ▼
requestId            — stamps x-request-id on every response, including errors (must run first)
helmet / cors / cookieParser / express.json / mongoSanitize / compression
morgan                — request logging (skipped in test env)
/health, /ready        — liveness vs readiness (readiness also checks DB connectivity)
/v1/*  no-store header
  │
  ▼
<module>.route.js
  │  Joi validation (platform/validate.js)
  │  auth middleware (platform/auth.js) — verifies JWT, attaches req.user
  ▼
<module>.controller.js → <module>.service.js → Mongoose → MongoDB
  │
  ▼
errorConverter → errorHandler   — anything thrown (including non-ApiError) becomes a
                                   consistent { error: { code, message, fields }, requestId } body
```

### Authentication architecture

Access token: short-lived JWT (default 15 min), returned in the response body, held
**in-memory only** on the frontend (`frontend/shared/api/client.js`) — never localStorage,
so it can't survive a tab close or be read by injected scripts.

Refresh token: longer-lived (default 30 days), stored as an **httpOnly cookie**; the server
persists only its SHA-256 hash on the `User` document (`refreshTokenSchema`), never the raw
token, capped at `MAX_REFRESH_TOKENS` per user with a separate consumed-token list to detect
reuse. See [`RBAC.md`](./RBAC.md) and [`SECURITY.md`](./SECURITY.md) for the authorization
model and full security posture.

### Capability-gated configuration

`platform/config.js` treats env vars as three tiers: **required** (boot fails without
them — `MONGODB_URL`, `JWT_SECRET`, `FRONTEND_BASE_URL`, `CORS_ORIGINS`), **optional**
(safe defaults), and **capability groups** (`storage` → S3, `email` → SMTP, `seed` → admin
bootstrap) that are all-or-nothing: fully absent silently disables the feature
(`config.features.{attachments,email,seed}`), partially present fails startup with a
descriptive error. In production, `JWT_SECRET` and `SEED_ADMIN_PASSWORD` are additionally
checked against a placeholder blocklist and a minimum length. This is the mechanism by
which file uploads and outbound email become optional in dev/CI without conditional code
scattered through the modules that use them.

### Notifications / email

`modules/notifications/dispatch.js` builds invite/reset "deliverers" injected into
`createApp()` at boot; `email.service.js` + `emailLog.model.js` handle actual sends and
logging when the `email` capability is present, `recipients.js` resolves who should be
notified for a given event. Email HTML comes from `shared/email/` (templates + assets),
imported by both backend delivery code and — per `shared/package.json`'s `./email` export —
anything else in the monorepo that needs to preview them.

### File storage

`platform/s3.js` + `platform/upload.js` (multer) handle attachment upload when the
`storage` capability group is configured; disabled otherwise (see config tiers above).

### Logging & monitoring

`platform/logger.js` (winston) for structured logs, `morgan` for HTTP access logs,
`requestId` middleware correlates both with client-visible error responses. No external
APM/metrics/tracing integration exists in the repo today — treat that as a gap, not an
assumption of hidden infrastructure.

## 4. Frontend architecture (`frontend/`)

### Route grouping

```
app/(auth)/    login, forgot/reset password, invite accept — public
app/(app)/     dashboard-style app: projects, teams, tickets, users, notifications, settings, dev — authenticated
```

`(auth)` and `(app)` are Next.js route groups (no URL segment); each has its own
`layout.jsx` for shell/guard differences.

### Shared layer

Anything reusable lives in `frontend/shared/`, never under `app/`:

```
shared/api/         one file per backend module — thin fetch wrappers over shared/api/client.js
shared/components/  UI, grouped by domain (teams/, tickets/, auth/, ui/) plus a few shared root-level dialogs
shared/contexts/    auth-context, project-context, theme-context (React context, not a state library)
shared/hooks/       shared hooks
shared/lib/         client-side validation, formatting, env access, misc utilities
```

Pages stay thin: fetch via `shared/api/*`, render via `shared/components/*`. See
[`UI_COMPONENTS.md`](./UI_COMPONENTS.md) for the component catalog and
[`DESIGN.md`](./DESIGN.md) for the visual system.

### State management

No global store (no Redux/Zustand/Jotai). State is: React Context for cross-cutting
concerns (auth session, active project, theme), local component state + effect-driven
fetches through `shared/api/*` for page data, and SWR specifically for notification
polling (`notification-bell.jsx`, notifications page) where background refresh is wanted.
This is a deliberate lightweight choice, not an oversight — don't introduce a global store
without a concrete case SWR/Context can't cover.

### API client

`shared/api/client.js` is the single fetch wrapper: attaches the in-memory access token as
`Authorization: Bearer`, normalizes error responses into `ApiClientError` (status, code,
message, field errors, request id — mirroring the backend's error shape), and exposes a
`setSessionLostHandler` hook so a 401 can trigger a global logout/redirect without every
call site handling it.

## 5. Deployment architecture

See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the full, code-grounded picture (env vars,
build/start commands, and — importantly — what CI/CD or container setup does or doesn't
exist in this repo today).

## 6. Module boundaries — summary

- **Backend module → platform**: allowed, one-directional.
- **Backend module → another module's service (public function)**: allowed when there's a
  real cross-domain need (e.g. ticket stats surfaced on team cards).
- **Backend module → another module's model/internals directly**: avoid; go through the
  owning module's service, or lift shared logic into `platform/`.
- **Frontend page (`app/`) → business logic**: avoid; logic belongs in
  `shared/components/`, `shared/lib/`, or `shared/api/`, with the page as a thin shell.
- **Frontend/backend duplication of a constant, enum, or status value**: avoid; put it in
  `shared/` and import via `@pms/shared` (see the `exports` map in `shared/package.json`
  for available subpaths: `.`, `./enums`, `./notification-events`, `./stages`,
  `./module-catalog`, `./email`).

## 7. Known technical limitations / debt

- **Authorization is coarse-grained.** `User.role` is a single global enum
  (`admin | lead | qa | developer | member`) — no per-project, per-team, or
  per-environment scoping yet, and no separate `Role`/`Permission` collections. This is the
  biggest gap versus the target model in [`RBAC.md`](./RBAC.md) and
  [`PRODUCT_PRINCIPLES.md`](./PRODUCT_PRINCIPLES.md).
- **No `Client`/`Organization`/`Environment` entities.** The domain today is
  `Project → Team → Ticket → User`, not the target
  `Organization → Client → Project → Team → Ticket/Task`. See
  [`DATA_MODEL.md`](./DATA_MODEL.md) and [`PROJECT_MODEL.md`](./PROJECT_MODEL.md).
- **No audit log.** Administrative/access changes aren't tracked anywhere.
- **No CI/CD or container config found in-repo** (confirm current state in
  [`DEPLOYMENT.md`](./DEPLOYMENT.md) rather than assuming).
- **Styling is split** between the legacy global `design-system.css` and newer
  Tailwind-based surfaces, with no written rule yet for which new work should use — see
  [`DESIGN.md`](./DESIGN.md).
- **`module-catalog.js`** in `shared/` still encodes a Dharwin-specific page taxonomy
  (ATS, courses, etc.) unrelated to this PMS's own routes — a leftover from the shared
  package's origin, worth confirming whether it's still consumed anywhere before treating
  it as live code.
