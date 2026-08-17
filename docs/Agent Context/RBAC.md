# RBAC — Roles, Authorization, Access Control

> Current implementation first, then the target model from
> `Agent Context/documentation-plan.md`. The two are not the same system yet —
> don't design new features against the target section without checking the
> current one first.

## Current Implementation

### Roles

Global, flat, five values — `backend/src/../shared/enums.js` (`ROLES`), stored on
`User.role` (`backend/src/modules/users/user.model.js:49`):

```
admin | lead | qa | developer | member
```

One role per user. No per-project, per-team, per-client, or per-environment role —
a user's role is the same everywhere in the system. `qa` and `developer` are
enumerated values with no distinct authorization behavior found in the backend
today (no route or service branches on them) — they exist for labeling/filtering,
not access control.

### Enforcement layers

Two middleware layers, both in `backend/src/platform/auth.js`:

1. **`auth(config)`** — authenticates. Verifies the JWT access token
   (`Authorization: Bearer`), re-reads the user's `role` and `status` from the
   database on every request (not trusted from the token payload — a revoked
   admin loses access on their *next* request, not when their access token
   happens to expire), rejects non-`active` users regardless of role.
2. **`requireRole(...roles)`** — authorizes by role only, run as route
   middleware *before* any document is loaded. Returns `403 FORBIDDEN` (never
   `404`) when the role doesn't match.

A third layer — **ownership/membership checks** — lives in services, after the
target document is loaded, because those rules need the document (reporter,
assignee, watcher, team membership) which doesn't exist yet at the route-middleware
stage. Found in `ticket.service.js`:

- View (`ticket.service.js:221`): reporter, assignee, tester (`testedBy`), watcher, team member, lead,
  or admin.
- Edit (`ticket.service.js:232`): reporter, assignee, lead, or admin.
- `ticket.service.js:298`, `:422`: additional admin/lead-only branches for
  specific fields/actions.

And in comment/attachment ownership (`comment.service.js:97`,
`attachment.service.js:188`): the author/uploader or an admin.

### Route-level role gates (current)

| Route | Requires |
|---|---|
| `POST/GET/PATCH/DELETE /v1/users*` | `admin` |
| `POST /v1/teams`, `PATCH /v1/teams/:id`, `PATCH /v1/teams/:id/members` | `admin` or `lead` |
| `POST /v1/projects`, `PATCH /v1/projects/:id`, `PUT /v1/projects/:id/modules` | `admin` |
| `DELETE /v1/tickets/:id` | `admin` |
| everything else under `/v1/tickets`, `/v1/teams` (read), `/v1/projects` (read) | any authenticated user, further narrowed by service-level ownership checks above |
| `/v1/tickets/analytics/*` | `auth()` only, deliberately **no** `requireRole` — comment in `analytics.route.js:34` notes this is intentional, not an oversight |

### What does NOT exist yet

- No project-scoped, team-scoped, client-scoped, or environment-scoped roles or
  permissions — `requireRole` checks the user's one global role, full stop.
- No `Permission` entity, no fine-grained permission list — authorization is
  role-name string matching, not permission flags.
- No concept of "environment" (dev/staging/production) anywhere in the schema
  or route layer.
- No audit log of role changes, access grants, or admin actions.
- No delegated/scoped admin (e.g. "admin of project X only").

## Target Model (not yet implemented)

From `Agent Context/documentation-plan.md`. This is aspirational — nothing below
this line exists in the codebase today.

```
User
  ↓
Role
  ↓
Permissions
  ↓
Scope
  ├── Organization
  ├── Client
  ├── Project
  ├── Team
  ├── Product/Module
  └── Environment
```

Candidate roles (only `admin`, `lead`, `qa`, `developer`, `member` are real today;
the rest are proposals):

- Super Admin
- Product Admin — manages an assigned product across multiple projects
- Project Manager
- Developer — e.g. Development + Staging, no Production
- Tester — e.g. Testing/Staging, no Production
- Support — restricted project/customer access
- Read-Only

Principles for the target model:

- Users receive only access explicitly granted to them — no implicit inheritance.
- **Production access must be explicit and must never be automatically inherited**
  by a developer or tester role from their dev/staging access.
- Every role/permission/scope change should be attributable (points at the not-yet-built
  audit log — see `SECURITY.md`).
- Access revocation should take effect promptly — the current `auth()` re-read-per-request
  pattern already gives this property for role changes and should be preserved for
  whatever scope-based check replaces `requireRole`.

### Migration note

Moving from today's flat role to the scoped target model is a schema and
middleware change, not a UI-only one: `requireRole` would need a scope
parameter (which project/team/environment), and every existing route using it
would need to supply that scope from `req.params` or the loaded document. Treat
this as a dedicated project, not an incremental add — mixing flat and scoped
checks in the same codebase is where a real access-control bug hides.
