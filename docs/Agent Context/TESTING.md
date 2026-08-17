# Testing

Reflects the test suites in the repo as of this writing. No E2E framework (Playwright,
Cypress, etc.) is present — everything below is unit/integration/component-level.

## Stack

| Workspace | Runner | Extras |
|---|---|---|
| `backend` | Node's built-in `node:test` (`node --test "**/*.test.js"`) | `supertest` for HTTP-level tests, `mongodb-memory-server` for a real in-memory MongoDB (no mocked DB) |
| `frontend` | Vitest (`vitest run`) | `@testing-library/react` + `@testing-library/user-event`, `jsdom` |

Root `npm test` runs `--workspaces --if-present`, so both suites run from the repo root.

Tests are colocated in `__tests__/` next to the code they cover, not in a separate top-level
test tree.

## Counts (file-level, as of this writing)

| Workspace | Test files | `test(...)`/`it(...)` cases |
|---|---|---|
| `backend/src` | 38 | ~320 |
| `frontend` | 34 | ~163 |

## Backend

### Integration / API tests (supertest against `createApp()`, real in-memory Mongo)

- `backend/src/__tests__/app.test.js` — boots the whole Express app and exercises
  `/health`, `/ready`, 404 handling, and the full auth HTTP flow: `POST /v1/auth/login`,
  `GET /v1/auth/me`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, including
  invalid-credential and unauthenticated cases.
- `backend/src/__tests__/seed.test.js`, `seed.projects.test.js` — the dev seed script.
- `backend/src/modules/tickets/__tests__/ticket.routes.test.js`,
  `transition.routes.test.js`, `analytics.routes.test.js` — ticket CRUD, stage
  transitions, and analytics endpoints at the HTTP layer.
- `backend/src/modules/users/__tests__/user.routes.test.js` — user endpoints at the HTTP
  layer.

### Unit / service / model tests

- `auth`: `auth.service.test.js`, `token.service.test.js`.
- `notifications`: `dispatch.test.js`, `email.service.test.js`, `recipients.test.js`.
- `projects`: `project.model.test.js`, `project.service.test.js`.
- `teams`: `team.service.test.js` — the only test file for this module.
- `tickets`: `ticket.model.test.js`, `ticket.create.test.js`, `ticket.list.test.js`,
  `ticket.patch.test.js`, `ticket.blocked.test.js`, `comment.service.test.js`,
  `attachment.service.test.js`, `transition.service.test.js`,
  `analytics.overview.test.js`, `analytics.quality.test.js`,
  `analytics.time-in-stage.test.js` — the most heavily tested module by a wide margin.
- `users`: `user.model.test.js`.
- `platform`: one file per cross-cutting concern — `auth.test.js` (JWT/cookie helpers),
  `config.test.js`, `errors.test.js`, `paginate.test.js`, `rateLimit.test.js`,
  `requestId.test.js`, `sameOrigin.test.js`, `toJSON.test.js`, `upload.test.js`,
  `validate.test.js`, `workspace.test.js`.

### Authentication / authorization tests

Authentication (login, token refresh, session cookie, invalid credentials) is covered at
the integration level in `app.test.js` and at the unit level in `auth.service.test.js` /
`token.service.test.js`.

There is no dedicated authorization test suite. The app's authorization model is a single
flat `role` field on `User` (`admin | lead | qa | developer | member` — see `shared/enums.js`,
"Authority in this product is this single field — there is no permission matrix"), so
role-gating is exercised only incidentally, wherever a route test happens to assert a
403/401. There is no test that systematically checks "role X cannot do Y" across modules.

## Frontend

### Component tests (Testing Library, jsdom)

`frontend/shared/components/__tests__/`: `app-loader`, `attachment-upload-loader`,
`notification-bell`, `profile-menu`, `project-modules-editor`, `project-switcher`,
`remark-dialog`, `theme-toggle`.

`frontend/shared/components/tickets/__tests__/`: `board-lane`, `ticket-comments`,
`ticket-detail-drawer`, `ticket-stage-bar`.

### Page tests

`projects` (list, new), `teams` (list, new, `[id]/edit`), `tickets` (`[id]/edit`, `new`,
`analytics`), `users`, and the `(auth)` group (`login`, `root-redirect`).

### Lib / utility tests

`frontend/shared/lib/__tests__/`: `active-project`, `api-error`, `attachment-config`,
`brand`, `deep-link`, `env`, `project-modules`, `validate-new-project`,
`validate-new-ticket`.

### API client tests

`frontend/shared/api/__tests__/client.js`, `tickets.js`.

## Critical business workflows — covered

- Login → session cookie → authenticated request → refresh → logout (`app.test.js`).
- Ticket create → list → patch → stage transition → analytics rollup (tickets module,
  both unit and route level — the deepest coverage in the repo).
- Ticket comments and attachments (service-level).
- Team creation/edit flow at the page level (`new-team.test.jsx`, `edit-team.test.jsx`),
  backed by `team.service.test.js` on the backend.

## Gaps / thin coverage

- **No E2E tests.** Nothing exercises a real browser against a real backend; all frontend
  tests render components/pages against mocked API calls in jsdom.
- **Teams module has the thinnest backend coverage of any module relative to its size**:
  only `team.service.test.js` exists — `team.model.js`, `team.controller.js`, and
  `team.route.js` have no dedicated or HTTP-level test (contrast with `tickets`, which has
  `ticket.routes.test.js` and `transition.routes.test.js` on top of service/model tests).
  This module was also the most recently and heavily redesigned (team cards, member
  picker, stats aggregation), which raises the risk of this gap mattering.
- **Projects and notifications have no route/controller-level (HTTP) test** — only
  model/service tests exist for `projects`; only `dispatch`, `email.service`, and
  `recipients` are tested for `notifications` (nothing exercises
  `notification.route.js` / `notification.controller.js` directly).
- **No dedicated authorization test suite** — role-based access is checked incidentally
  inside other tests, not as its own suite (see above).
- **Frontend routes with no test at all**: `app/(app)/tickets/page.jsx` (the main
  board/list page itself — though its constituent components like `board-lane` and
  `ticket-stage-bar` are unit-tested), `app/(app)/notifications/page.jsx`,
  `app/(app)/settings/notifications/page.jsx`, `app/(app)/dev/emails/page.jsx` (dev-only
  tool), and the `(auth)` `forgot-password`, `reset-password`, and `invite/accept` pages.
- **`member-picker.jsx` and `member-list.jsx` (teams) have no dedicated component test** —
  only exercised indirectly through the `teams` and `edit-team` page tests. Notable
  because the member picker was recently rebuilt as a full popover component.
