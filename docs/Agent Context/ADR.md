# Architecture Decision Records

Extracted from in-code comments and commit messages. Only decisions with a traceable
rationale in the repository are recorded here; where the reasoning wasn't captured, that's
stated explicitly rather than guessed at.

## ADR-001: `requestId` middleware runs first, before everything else

Status: Accepted
Date: Unknown / needs confirmation (predates the sampled commit history)

Context: Express middleware order determines which responses carry a request id.

Decision: `app.use(requestId)` is the very first middleware in `backend/src/app.js`, ahead
of `helmet`, `cors`, body parsing, and all routing.

Reason (from source comment, `backend/src/app.js:23-24`): "Every response — including 401
and 404 — must carry a request id, which is only true if this precedes auth, validation and
routing." Placing it later would leave error responses from earlier middleware without a
request id.

Consequences: Any new middleware added to `app.js` must go after `requestId`, or it silently
loses request-id coverage for whatever it might reject.

Alternatives considered: Not documented in the codebase.

---

## ADR-002: Separate `/health` (liveness) and `/ready` (readiness) endpoints

Status: Accepted
Date: Unknown / needs confirmation

Context: A single health endpoint can't distinguish "process is running" from "process can
actually serve a request."

Decision: `GET /health` always returns 200 if the process is up. `GET /ready` checks
`isDbReady()` and returns 503 when the database connection isn't ready.

Reason (from source comment, `backend/src/app.js:44-45`): "Liveness: is the process up.
Readiness: can it actually serve. Without the second, a process reports healthy while unable
to answer a single request."

Consequences: Any orchestrator/load-balancer health check should point at `/ready`, not
`/health`, if the intent is to gate traffic on the app actually being usable.

Alternatives considered: Not documented in the codebase.

---

## ADR-003: Backend and frontend each own a separate `.env` file (no shared root `.env`)

Status: Accepted
Date: commit `65268da` — "refactor: give the backend and frontend their own .env files"

Context: A single root `.env` was previously shared by both apps.

Decision: `backend/.env` (loaded by `backend/src/platform/loadEnv.js` via `dotenv`) and
`frontend/.env` (loaded natively by Next) are independent files. Neither app reads the
other's. There is no root `.env` or `.env.example`, and none should be added.

Reason (from commit message): a shared root `.env` force-loaded the backend's `NODE_ENV` and
`PORT` into the Next config process, but Next overrides both anyway (`next dev` always forces
development, `next build`/`next start` always force production) — so those values "read as
frontend configuration while having no effect at all." That mismatch made real failures
unreadable: a production build served by a dev server 404s every client chunk, while a
leftover `NODE_ENV=development` in the shared file claimed the opposite was true. Removing
the shared file also let the frontend drop the `@next/env` import, a `forceReload` call
needed to beat its own module-scope cache, and an env-passthrough bridge between the two
apps.

Consequences: Adding a new env var that both apps genuinely need means adding it to both
`.env`/`.env.example` files, not introducing a shared file. Both `.env.example` files now
state the `NODE_ENV`/`PORT` rules inline as a guardrail.

Alternatives considered: Not documented beyond the shared-file approach that was replaced.

---

## ADR-004: npm workspaces monorepo (`shared`, `backend`, `frontend`)

Status: Accepted (current state)
Date: Unknown / needs confirmation

Context: Two deployable apps (Express API, Next.js frontend) need to share constants, enums,
and email templates without duplicating them.

Decision: A single repo root with `"workspaces": ["shared", "backend", "frontend"]`
(`package.json`). `@pms/shared` is depended on by both apps as `"@pms/shared": "*"`, resolved
via workspace symlink rather than a published package.

Reason: Not documented in the codebase — plausible (single source of truth for
enums/stages/notification events/email templates, one `npm install`, one `npm test
--workspaces`) but not stated anywhere in comments or commit messages.

Consequences: Any constant, enum, or status value used by both apps belongs in `shared/`,
not duplicated locally (see `ARCHITECTURE.md` conventions).

Alternatives considered: Not documented in the codebase.

---

## ADR-005: Backend modules are vertical slices, not horizontal layers

Status: Accepted (current state)
Date: Unknown / needs confirmation

Context: Domain code (teams, projects, tickets, users, auth, notifications) needs an
organizing structure.

Decision: Each `backend/src/modules/<name>/` folder owns its full stack for that domain:
`.model.js`, `.route.js`, `.controller.js`, `.service.js`, `.validation.js`. There is no
repo-wide `/controllers`, `/models`, `/routes` split. Cross-cutting infrastructure (config,
db, auth/JWT, errors, rate limiting, pagination, upload, mailer, logger) lives separately in
`backend/src/platform/`, imported by modules one-way (modules → platform, never the reverse).

Reason: Not documented in the codebase — no comment or commit message explains the choice of
vertical-slice-per-module over a layered structure.

Consequences: A new backend feature gets a new module folder with the same five-file shape,
not new files scattered across shared `controllers/`/`models/` directories.

Alternatives considered: Not documented in the codebase.

---

## ADR-006: `design-system.css` is the global, unlayered baseline; Tailwind is bolted on for shadcn/ui only

Status: Accepted (current state)
Date: Unknown / needs confirmation (Tailwind/shadcn added per commit `7951325`,
"replace hand-rolled nav rail with shadcn/ui sidebar")

Context: The app predates shadcn/ui and already had a full CSS system; shadcn/ui components
expect Tailwind.

Decision (from source comment, `frontend/app/globals.css:1-14`): `design-system.css` is
loaded unlayered and owns the global reset plus every page that predates shadcn. Tailwind is
loaded alongside it, scoped to shadcn components: Tailwind's `preflight` is deliberately NOT
imported (it would re-reset the app on top of `design-system.css`'s own reset — the few rules
shadcn's utilities actually need are recreated, scoped, in a `shadcn-compat` layer instead);
`theme.css` is imported inside a CSS `@layer` so its `:root` variables can never outrank
`design-system.css`; `utilities.css` stays unlayered and last so utility classes like
`border` can still outrank element selectors such as `button{border:none}`.

Reason: explicit in the comment — deliberate cascade ordering to let two styling systems
coexist without one silently overriding the other.

Consequences: New pages should default to `design-system.css` classes; Tailwind utility
classes in JSX are only expected on the shadcn-based surfaces (verify which convention the
specific page already uses before adding new styles — see `ARCHITECTURE.md`).

Alternatives considered: Not documented in the codebase.

---

## ADR-007: Refresh tokens live in an `httpOnly`, `sameSite=strict` cookie

Status: Accepted (current state)
Date: Unknown / needs confirmation

Context: The access/refresh JWT pair needs a transport that survives page reloads without
being readable by client-side JS.

Decision: `backend/src/modules/auth/auth.controller.js` sets the refresh token via
`res.cookie(...)` with `httpOnly: true`, `secure: config.cookie.secure` (true in production),
`sameSite: 'strict'`, `domain: config.cookie.domain`. The access token is not set as a
cookie in this file — **Unknown / needs confirmation** how the access token is delivered to
and stored by the frontend; not traced as part of this audit.

Reason: Not documented in the codebase — no comment explains the `httpOnly`/`sameSite=strict`
choice, though it is standard practice for mitigating XSS token theft and CSRF respectively.

Consequences: `sameSite=strict` means the refresh cookie won't be sent on cross-site
navigations (e.g. clicking a link from an external site into the app) — a deliberate or
incidental tradeoff not explained in-repo.

Alternatives considered: Not documented in the codebase.
