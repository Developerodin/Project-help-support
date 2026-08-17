# API

REST API served by `backend/src/app.js`. All application routes are mounted under `/v1`.
Two unversioned endpoints exist outside it: `GET /health` (liveness, always 200) and
`GET /ready` (readiness — 200/503 based on DB connection, `{ status, checks: { database } }`).

Every response — success or error — carries `X-Request-Id`; error bodies also echo it as
`requestId`.

## Conventions

**Auth.** Bearer JWT access token in `Authorization: Bearer <token>`, checked by the `auth()`
middleware (`backend/src/platform/auth.js`): token must verify, and the user it names must
exist with `status: 'active'` (an invited/inactive user is rejected regardless of role). The
role used for authorization is re-read from the DB on every request, not trusted from the
token payload — a revoked admin loses access on their next request, not at token expiry.
Every router below except `/v1/auth`'s public routes applies `auth()` to the whole router.

Refresh tokens are a separate `httpOnly`, `Strict` cookie (`pms_refresh`, path
`/v1/auth`) — not a bearer token, not readable by JS. State-changing `/v1/auth` routes that
rely on that cookie (`refresh`, `logout`) are also protected by `sameOrigin()` — an
Origin/Referer check — as CSRF defense-in-depth on top of `SameSite=Strict`.

**Authorization.** Role-only gating is `requireRole(...roles)`, applied as route middleware
before any DB read — it can only check `req.user.role`, not document ownership. Roles:
`admin`, `lead`, `qa`, `developer`, `member` (`shared/enums.js` — flat field, no permission
matrix). Document-level rules (comment author, ticket assignee/reporter, ticket-transition
legality per role) are enforced inside services, after the record loads, and are documented
per-endpoint below. A role failure is `403 FORBIDDEN`, not `404` — nothing in this product is
existence-concealed.

**Validation.** Every route with input runs a Joi schema via `validate()`
(`backend/src/platform/validate.js`) against `params`/`query`/`body`. Unknown keys are
rejected (400), not dropped — silently stripping an unexpected `role` field would hide a
privilege-escalation attempt rather than reject it. A failure is:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Validation failed", "fields": { "email": "must be a valid email" } }, "requestId": "..." }
```

**Errors.** Every error response has the shape:

```json
{ "error": { "code": "STRING_CODE", "message": "human readable", "fields": {} }, "requestId": "..." }
```
`fields` is present only on `VALIDATION_ERROR`. In production, non-operational (unexpected)
errors hide their message behind `"Internal server error"`; operational `ApiError`s
(validation, auth, not-found, conflict, etc.) always show their real message.

**Pagination.** List endpoints backed by `paginate()` (`backend/src/platform/paginate.js`)
accept `page` (default 1), `limit` (default 20, max 100), and `sortBy` as
`"field:asc,other:desc"` (default `createdAt:desc`), and return:

```json
{ "results": [...], "page": 1, "limit": 20, "totalPages": 3, "totalResults": 42 }
```

**Optimistic concurrency.** Ticket mutation endpoints (`patch`, `assign`, `transition`,
`block`/`clear-block`) require a `revision` integer in the body matching the ticket's current
revision; a mismatch is rejected by the service (not shown as a distinct schema field below
since the conflict check happens post-validation).

---

## Auth — `/v1/auth` (`backend/src/modules/auth/`)

Only auth route that requires a token: `GET /me`. Everything else here is intentionally
public (login, refresh, invite, password reset) — several use `byEmail` rate limiting.

| Method | Path | Auth | Role | Body / Query | Response | Notes |
|---|---|---|---|---|---|---|
| POST | `/login` | — | — | `{ email, password }` | 200 `{ user, accessToken }` + sets `pms_refresh` cookie | Rate-limited 10/15min per email. |
| POST | `/refresh` | — (cookie) | — | — (reads `pms_refresh` cookie) | 200 `{ user, accessToken }` + rotates cookie | `sameOrigin` check; 401 `INVALID_REFRESH_TOKEN` if cookie missing/invalid. Rate-limited 60/15min per IP. |
| POST | `/logout` | — (cookie) | — | — | 204 + clears cookie | `sameOrigin` check. |
| GET | `/me` | required | any active user | — | 200 `{ user }` | |
| POST | `/invite/preview` | — | — | `{ token }` | 200 invite preview | Rate-limited 10/60min per IP. |
| POST | `/invite/accept` | — | — | `{ token, name, password }` | 200 `{ user }` | Rate-limited 10/60min per IP. |
| POST | `/forgot-password` | — | — | `{ email }` | 200 `{ message }` (identical whether or not the email exists — not an account-existence oracle) | Rate-limited 5/60min per email. |
| POST | `/reset-password` | — | — | `{ token, password }` | 204 | Rate-limited 5/60min per email. |

## Teams — `/v1/teams` (`backend/src/modules/teams/`)

All routes require auth. Mutations require `admin` or `lead`.

| Method | Path | Role | Query / Body | Response |
|---|---|---|---|---|
| GET | `/` | any | `project`, `status` (`active`\|`archived`), `page`, `limit`, `sortBy` | paginated list |
| POST | `/` | admin, lead | `{ name, project?, lead?, members? }` | 201 team |
| GET | `/:id` | any | — | team |
| PATCH | `/:id` | admin, lead | any of `{ name, project, lead, status }` | team |
| PATCH | `/:id/members` | admin, lead | `{ add?: [userId], remove?: [userId] }` (at least one) | team |

## Projects — `/v1/projects` (`backend/src/modules/projects/`)

All routes require auth. Create/update/modules require `admin`. `key` is set only at
creation (`/^[A-Z][A-Z0-9]{1,9}$/`) and explicitly forbidden on update — attempting to change
it returns a 400 with a dedicated message rather than a generic "unknown field" error.

| Method | Path | Role | Query / Body | Response |
|---|---|---|---|---|
| GET | `/` | any | `status`, `page`, `limit`, `sortBy` | paginated list |
| GET | `/brands` | any | — | list of distinct brand names |
| POST | `/` | admin | `{ brand, key?, name, description?, defaultAssignee?, defaultTester?, defaultTeam?, modules? }` | 201 project |
| GET | `/:id` | any | — | project |
| PATCH | `/:id` | admin | any of `{ brand, name, description, status, defaultAssignee, defaultTester, defaultTeam }` (`key` forbidden) | project |
| PUT | `/:id/modules` | admin | `{ modules: [{ label, pages: [{ label, path }] }] }` | project (modules replaced wholesale) |

## Tickets — `/v1/tickets` (`backend/src/modules/tickets/`)

All routes require auth. `DELETE /:id` requires `admin`; everything else is auth-only at the
route layer, with per-action legality enforced in services (see Notes). `:id` accepts either
a Mongo ObjectId or the human-readable ticket id, on every route that takes one.

| Method | Path | Role | Body / Query | Response | Notes |
|---|---|---|---|---|---|
| GET | `/` | any | `project, status, priority, severity, label, module, assignedTo, team, q, scope, blocked, overdue, reopened, sortBy, page, limit` | paginated list | `status` values are the 10 `STAGE_KEYS` (`shared/stages.js`): pending → under_review → in_progress → ready_local → ready_qa → deployed_staging → qa_approved → ready_production → live → closed. |
| POST | `/` | any | `{ project, title, description, stepsToReproduce?, module?, page?, category?, labels?, severity?, priority?, environment?, assignedTo?, testedBy?, team?, watchers? }` | 201 ticket | Fires a `TICKET_CREATED` notification event after responding (failure never turns the create into a 500). |
| POST | `/bulk` | any | `{ action: 'assign'\|'delete', ids: [ref] (1–200), assignedTo?, team? }` | bulk result | Registered before `/:id` so `"bulk"` isn't parsed as a ticket ref. |
| GET | `/:id` | any | — | ticket | |
| PATCH | `/:id` | any | `{ revision, title?, description?, ...fields }` (`status` and `createdBy` are forbidden — 400 pointing at `/transition`) | ticket | Fires `TICKET_ESTIMATE_SET` if `estimatedResolutionAt`/`expectedReleaseDate` changed. |
| DELETE | `/:id` | admin | — | result | |
| POST | `/:id/assign` | any | `{ revision, assignedTo?, team? }` | ticket | Fires `TICKET_ASSIGNED`. |
| POST | `/:id/transition` | any\* | `{ to, revision, note?, reason? }` | ticket | \*Legality is per-stage-and-role via `canTransition()` (`shared/stages.js`), not `requireRole` — e.g. entering `under_review`/`in_progress` needs `lead`/`admin` (or the assignee relationship where listed), `qa_approved` needs `qa`/`admin`. Reopen (backward move) always targets `in_progress`, only from `ready_qa` onward, and is gated separately (`admin`, `lead`, `qa`, or the assignee). Fires the resulting event type. |
| POST | `/:id/watch` | any | — | ticket | |
| DELETE | `/:id/watch` | any | — | ticket | |
| POST | `/:id/block` | any | `{ revision, reason }` | ticket | |
| DELETE | `/:id/block` | any | `{ revision }` | ticket | |
| POST | `/:id/comments` | any | `{ content, mentions?, clientRef? }` | 201 (or 200 if `clientRef` replays an existing comment) comment | Notification fires only on actual create, never on replay. |
| PATCH | `/:id/comments/:commentId` | author (service-enforced) | `{ content }` | comment | |
| DELETE | `/:id/comments/:commentId` | author (service-enforced) | — | result | |
| PUT | `/:id/comments/:commentId/reactions` | any | `{ emoji }` | comment (toggles the reaction) | |
| POST | `/:id/attachments` | any | multipart file upload + `{ clientRef?, commentId?, commentContent?, commentClientRef? }` (`commentId`/`commentContent` mutually exclusive) | 201 attachments | Goes through `uploadMiddleware` (multer) before validation. |
| DELETE | `/:id/attachments/:attachmentId` | any (service-enforced) | — | result | |
| GET | `/:id/attachments/:attachmentId/download` | any | — | 302 redirect to signed S3 URL, or `{ url }` JSON if `Accept: application/json` (needed for fetch+Bearer clients, which can't read a cross-origin redirect's Location header) | |

## Ticket Analytics — `/v1/analytics` (`backend/src/modules/tickets/analytics.route.js`)

Auth-only — **no `requireRole`**. Deliberate: this looks like an admin screen but isn't;
every active user may read it. Shares the same filter surface as the ticket list so a
dashboard tile and the underlying list always agree.

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/overview` | `project, status, severity, priority, team, assignedTo, module, scope` | `{ ...tiles, estimates, reopens, aging }` — 4 independent reads issued together |
| GET | `/trend` | above + `groupBy` (`day`\|`week`) | trend series |
| GET | `/time-in-stage` | same as `/overview` | time-in-stage breakdown |
| GET | `/drill` | above + `dimension` (`module`\|`severity`\|`assignee`, required) | drill-down breakdown |

## Users — `/v1/users` (`backend/src/modules/users/`)

All routes require auth. `/me` and `/me/notification-prefs` are registered before `/:id`
(else `"me"` parses as a user id). List/create/get-by-id/update/delete/resend-invite all
require `admin`.

| Method | Path | Role | Body / Query | Response | Notes |
|---|---|---|---|---|---|
| PATCH | `/me` | any active user | `{ name }` | user | |
| PATCH | `/me/notification-prefs` | any active user | `{ email?: {event: bool}, inApp?: {event: bool} }` (unknown event keys rejected) | prefs | |
| GET | `/` | admin | `role, status (invited\|active\|inactive), q, page, limit, sortBy` | paginated list | |
| POST | `/` | admin | `{ email, role? }` | 201 user | Creates an invite; the raw invite token is handed only to the injected `deliverInvite` function, never returned in the response body. |
| GET | `/:id` | admin | — | user | |
| PATCH | `/:id` | admin | any of `{ name, role, status }` | user | |
| DELETE | `/:id` | admin | — | result | |
| POST | `/:id/resend-invite` | admin | — | `{ status: 'ok', sent: boolean }` | No-op (`sent: false`) unless the target user is still `status: 'invited'`. Rate-limited 10/60min per IP. |

## Notifications — `/v1/notifications` (`backend/src/modules/notifications/`)

All routes require auth; scoped to `req.user` (no cross-user access).

| Method | Path | Query / Body | Response |
|---|---|---|---|
| GET | `/` | `unread` (bool), `page`, `limit` | paginated list |
| POST | `/read-all` | — | result |
| PATCH | `/:id/read` | — | notification |

---

## Endpoint counts

| Module | Endpoints |
|---|---|
| auth | 8 |
| teams | 5 |
| projects | 6 |
| tickets | 19 |
| ticket analytics | 4 |
| users | 8 |
| notifications | 3 |
| **Total** | **53** (+ `/health`, `/ready`) |
