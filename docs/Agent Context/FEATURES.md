# Features

Inventory of what exists in the repository today. `IMPLEMENTED` requires a working backend
module (route + controller + service) *and* a frontend route/page consuming it. `PARTIAL`
means one side exists without the other, or the capability is a fragment of a larger
concept (e.g. a role field with no permission matrix). Nothing below is marked `PLANNED` —
no roadmap, TODO, or "not yet implemented" markers were found in the codebase to justify
one; nothing is invented here that isn't already present in code.

| Feature | Status | Location | Description |
|---|---|---|---|
| Authentication | IMPLEMENTED | `backend/src/modules/auth/`, `frontend/app/(auth)/` | Cookie-based JWT login/logout/refresh, password reset, invite-accept flow. See `docs/TESTING.md` for coverage. |
| Users | IMPLEMENTED | `backend/src/modules/users/`, `frontend/app/(app)/users/` | User list/detail, single flat `role` field (`admin/lead/qa/developer/member`), per-user notification preferences. |
| Teams | IMPLEMENTED | `backend/src/modules/teams/`, `frontend/app/(app)/teams/` | Team CRUD, member add/remove via a people-picker popover (`member-picker.jsx`), per-team ticket stats (open/overdue counts) aggregated server-side. |
| Projects | IMPLEMENTED | `backend/src/modules/projects/`, `frontend/app/(app)/projects/` | Project list + create. No project-edit page exists (`projects/new/` only; no `projects/[id]/edit/`). |
| Tickets | IMPLEMENTED | `backend/src/modules/tickets/`, `frontend/app/(app)/tickets/` | The most fully built module: CRUD, board view (`board-lane.jsx`), stage transitions with a defined stage machine (`stages.js`), comments, attachments (S3-backed), "blocked" state. |
| Ticket stage transitions | IMPLEMENTED | `backend/src/modules/tickets/transition.*`, `shared/stages.js` | The closest thing in this codebase to a "workflow engine" — a fixed set of stages/decisions per ticket, not a configurable workflow builder. |
| Ticket comments | IMPLEMENTED | `backend/src/modules/tickets/comment.service.js`, `frontend/shared/components/tickets/ticket-comments.jsx` | |
| Attachments | IMPLEMENTED | `backend/src/modules/tickets/attachment.service.js`, `backend/src/platform/s3.js`, `frontend/shared/components/attachment-upload-loader.jsx` | Scoped to tickets; no generic attachment entity usable outside tickets. |
| Ticket analytics / reports | IMPLEMENTED | `backend/src/modules/tickets/analytics.*`, `frontend/app/(app)/tickets/analytics/` | Overview stats, quality metrics, time-in-stage — ticket-scoped only, not a general reporting engine. |
| Notifications (in-app) | IMPLEMENTED | `backend/src/modules/notifications/`, `frontend/app/(app)/notifications/`, `notification-bell.jsx` | |
| Notifications (email) | IMPLEMENTED | `backend/src/modules/notifications/email.service.js`, `dispatch.js`, `backend/src/platform/mailer.js` | Per-user preferences at `frontend/app/(app)/settings/notifications/`. `frontend/app/(app)/dev/emails/` is a developer-only template preview tool, not a user-facing feature. |
| Search / filtering | PARTIAL | `frontend/app/(app)/teams/page.jsx` | Client-side search + scope filter exists on the Teams page. No equivalent search/filter UI was found on Projects or Users; Tickets filtering lives in the board/lane grouping rather than a search box. |
| Access control (RBAC) | PARTIAL | `shared/enums.js` (`ROLES`), `User.role` | A single flat role field per user, no scoped permissions. Verbatim from the code: *"Authority in this product is this single field — there is no permission matrix."* There is no product/project/environment-scoped access model, no per-project or per-team role assignment, and no admin UI for managing roles beyond the user record itself. See `docs/RBAC.md` for the gap between this and the target model. |
| Environments (ticket field) | PARTIAL | `Ticket.environment` (`Staging`/`Production`, `shared/enums.js`) | This is a descriptive field on a ticket ("which environment does this bug affect"), not an access-control scope. There is no concept of granting/restricting a user's *access* to an environment. |
| Clients / Organizations | NOT PRESENT | — | No `Client` or `Organization` entity, model, or route exists anywhere in the codebase. The only occurrences of "client" in backend code are `clientRef` (an idempotency key for attachment uploads) and `frontend`/`backend` package naming — unrelated to a Client business entity. |
| Audit / activity log | NOT PRESENT | — | No audit log model, route, or service was found. |
| Settings | PARTIAL | `frontend/app/(app)/settings/` | Only a notifications-preferences page exists under `settings/` today; no other settings sections. |
| Dashboard | NOT PRESENT | — | No `/dashboard` route exists in `frontend/app/(app)/`. `shared/module-catalog.js` lists a "Dashboard" page, but that file is an explicitly-labeled port of a *different, external* Dharwin navigation taxonomy ("Ported from Dharwin Help & Support dev-ticket-modules.ts... Keep in sync when Dharwin navigation changes") used for ticket location fields — it is not this app's own route map or roadmap, and should not be read as one. |

## Notes on scope vs. the target "general-purpose PMS" model

The features above describe the system as it exists today: a Dharwin-shaped ticket/team/
project tracker with a flat user role. The `Client → Project → Team → Ticket` hierarchy,
scoped RBAC, and environment-based access control described in
`Agent Context/documentation-plan.md` and `docs/RBAC.md` / `docs/PROJECT_MODEL.md` are
target-state design, not implemented features — see those documents for the CURRENT vs.
TARGET split.
