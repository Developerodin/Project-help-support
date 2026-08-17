# Phase 1: Client Entity + Internal Access-Control Core — Design

Status: approved design, not yet implemented.
See [`Agent Context/RBAC.md`](../../Agent%20Context/RBAC.md), [`PROJECT_MODEL.md`](../../Agent%20Context/PROJECT_MODEL.md), [`PRODUCT_PRINCIPLES.md`](../../Agent%20Context/PRODUCT_PRINCIPLES.md), and [`SECURITY.md`](../../Agent%20Context/SECURITY.md) for the current-state analysis this design builds on.

## 1. Why, and why this scope

Today, authorization is a single flat `User.role` (`admin|lead|qa|developer|member`) enforced by `requireRole()` — every admin can act on every project, there is no client/project/environment boundary, and there is no audit trail of who granted or changed access (`SECURITY.md` gap #2, #1). This PMS is being used by one service company to run projects for multiple external clients, and access needs to be scoped per client/project/environment, with production access never implicitly inherited.

The full ask (external client login/portal, dynamic ticket configuration, custom fields, access requests/reviews, SSO/MFA) is six separable projects, not one. This spec covers only the foundation everything else depends on: a real `Client` entity and an internal, scoped, auditable authorization core. See [§9 Explicitly out of scope](#9-explicitly-out-of-scope) for the rest and their intended order.

## 2. In scope

- `Client` entity; `Project` scoped to a `Client`
- `AccessAssignment` — scoped grants (role × client × project × environment)
- Existing five roles (`admin`, `lead`, `qa`, `developer`, `member`) as static permission bundles — no new roles, no DB-editable roles/permissions
- `can()` (resource authorization) and `canDelegate()` (grant/revoke authorization) as the sole authorization path, replacing `requireRole`
- Default-deny, explicit environment grants, last-global-admin protection, no self-escalation
- `AuditLog` (append-only) for every access/role/client mutation
- Migration of existing users/projects into the new model
- UI: Clients page, Users & Access (profile drawer + grant flow), Audit Log page
- Unit + integration tests

## 3. Explicitly out of scope for Phase 1

Deferred, not rejected — see [§9](#9-explicitly-out-of-scope) for why this foundation supports them without a rewrite: client portal / external auth, dynamic ticket types/priorities/labels/environments, custom fields, workflow builder, Access Matrix, Roles & Permissions editor, Access Requests, Access Reviews, JIT access, SSO/SCIM/MFA, audit-log export/analytics.

## 4. Data model

### 4.1 `Client` (new collection)

| Field | Type | Notes |
|---|---|---|
| `name` | String, required, trimmed | Replaces `Project.brand` as the real client grouping. Uniqueness validated at the service layer against `active` clients only (not a DB unique index), so an archived client's name can be reused |
| `status` | enum `active`\|`archived`, default `active`, indexed | |
| `createdBy` | ObjectId → User, required | |
| `timestamps` | — | `createdAt`/`updatedAt` |

`Project` gains `client: ObjectId → Client` (required going forward). `Project.brand` is deprecated post-migration (kept on the schema, no longer written by new code, safe to drop in a later cleanup once nothing reads it).

### 4.2 `AccessAssignment` (new collection)

| Field | Type | Notes |
|---|---|---|
| `user` | ObjectId → User, required, indexed | |
| `role` | String enum `ROLES` (existing five), required | Defines *what* |
| `client` | ObjectId → Client, default `null`, indexed | `null` = all clients (global) |
| `project` | ObjectId → Project, default `null`, indexed | `null` = all projects under `client`. **Validator: may only be set if `client` is also set.** |
| `environments` | `[String]`, enum `ENVIRONMENTS`, default `[]` | Empty = no access to environment-bearing actions (tickets), not "all" — must be listed explicitly |
| `status` | enum `active`\|`suspended`, default `active`, indexed | |
| `expiresAt` | Date, default `null` | Schema-ready for future time-bound access; no expiry *workflow* in Phase 1, just the field and its enforcement in `can()` |
| `grantedBy` | ObjectId → User, required | |
| `reason` | String | |
| `timestamps` | — | |

Indexes: compound `{ user: 1, status: 1 }`, `{ client: 1, project: 1 }`.

`ENVIRONMENTS` (`@pms/shared/enums.js`) expands from `['Staging','Production']` to `['Development','Staging','Production']` — `Ticket.environment` keeps using the same enum, unchanged shape.

### 4.3 `AuditLog` (new collection, append-only)

| Field | Type | Notes |
|---|---|---|
| `actor` | ObjectId → User, required | |
| `action` | String enum, required, indexed | `ACCESS_GRANTED`, `ACCESS_MODIFIED`, `ACCESS_REVOKED`, `CLIENT_CREATED`, `CLIENT_UPDATED`, `USER_SUSPENDED`, `USER_REACTIVATED` |
| `targetType` / `targetId` | String / ObjectId | e.g. `'AccessAssignment'` / its id |
| `client` / `project` | ObjectId → Client/Project, nullable | |
| `before` / `after` | Mixed | Snapshot of the changed fields only |
| `reason` | String | |
| `requestId` | String | Correlates with the existing `X-Request-Id` (`platform/requestId.js`) |
| `createdAt` | Date, indexed | No `updatedAt` — the collection is never updated |

Indexes: `{ actor: 1, createdAt: -1 }`, `{ client: 1, createdAt: -1 }`, `action`. No update/delete route is ever exposed for this collection.

### 4.4 Permission registry (static, code, not a collection)

`@pms/shared/permissions.js`:

```
PERMISSIONS = [
  'clients.view', 'clients.manage',
  'projects.view', 'projects.manage',
  'teams.view', 'teams.manage',
  'tickets.view', 'tickets.create', 'tickets.update', 'tickets.delete', 'tickets.assign',
  'users.view', 'users.manage',
  'access.view', 'access.grant', 'access.revoke',
  'audit.view',
]
```

### 4.5 Role → permission matrix (Phase 1)

| Permission | admin | lead | qa / developer / member |
|---|:-:|:-:|:-:|
| clients.view | ✓ | ✓ | ✓ |
| clients.manage | ✓ | | |
| projects.view | ✓ | ✓ | ✓ |
| projects.manage | ✓ | | |
| teams.view | ✓ | ✓ | ✓ |
| teams.manage | ✓ | ✓ | |
| tickets.view / create / update | ✓ | ✓ | ✓ |
| tickets.delete | ✓ | | |
| tickets.assign | ✓ | ✓ | |
| users.view / users.manage | ✓ | | |
| access.view / access.grant / access.revoke | ✓ | | |
| audit.view | ✓ | | |

This reproduces today's actual route-level behavior (`RBAC.md`'s current table) — `qa`/`developer`/`member` get the same bundle because none of them have distinct backend behavior today either. Existing **ownership checks** in `ticket.service.js` (reporter/assignee/watcher/team-member/lead/admin for view; reporter/assignee/lead/admin for edit) are preserved unchanged, layered *on top of* — not replacing — the new scope+permission check: `can()` answers "is this role/scope combination allowed to act on tickets here at all," ownership answers "is this the specific ticket this user may touch."

**Edge case, resolved**: a global Team (`Team.project === null`, usable on every project) has no single owning client. `teams.manage` on a global team requires a **global** `AccessAssignment` (`client: null`); a client/project-scoped assignment's `teams.manage` only reaches teams scoped to that project.

## 5. Authorization core

`backend/src/platform/authorize.js`, two functions, deliberately not merged (they answer different questions and must not be unified later just for code reuse):

```js
async function can(user, permission, { clientId, projectId, environment } = {}) {
  if (user.status !== 'active') return false;
  const assignments = await activeAssignmentsFor(user.id);
  const matching = assignments.filter(a => matchesScope(a, { clientId, projectId, environment }));
  return matching.some(a => ROLE_PERMISSIONS[a.role].includes(permission));
}

function matchesScope(a, { clientId, projectId, environment }) {
  if (a.client && String(a.client) !== String(clientId)) return false;
  if (a.project && String(a.project) !== String(projectId)) return false;
  if (environment && !a.environments.includes(environment)) return false;
  return true;
}

async function canDelegate(actor, { permission, role, clientId, projectId, environments = [] }) {
  if (actor.status !== 'active') return false;
  const assignments = await activeAssignmentsFor(actor.id);
  const containing = assignments.filter(a => containsScope(a, { clientId, projectId, environments }));
  const delegable = new Set(containing.flatMap(a => ROLE_PERMISSIONS[a.role]));
  if (!delegable.has(permission)) return false;
  return ROLE_PERMISSIONS[role].every(p => delegable.has(p));
}

function containsScope(a, target) {
  if (a.client && String(a.client) !== String(target.clientId)) return false;
  if (a.project && String(a.project) !== String(target.projectId)) return false; // a project-specific assignment can't contain a broader/other request
  if (target.environments.length && !target.environments.every(e => a.environments.includes(e))) return false;
  return true;
}
```

`activeAssignmentsFor()` filters `status: 'active'` and `expiresAt: null OR expiresAt > now`.

**Scope resolution rule**: whenever a route/service receives both a `projectId` and a `clientId`, it must load the project and use its actual `client` — a caller-supplied `clientId` that doesn't match is a hard reject (400/403), never trusted. This applies identically to `can()` call sites and `canDelegate()` call sites.

**Why `canDelegate` prevents escalation without special-casing**: "only a global admin can grant global admin" is not a coded special case — it falls out of `containsScope`, since only a `client: null` assignment can ever contain another `client: null` request.

Route middleware: `requirePermission(permission, scopeResolver)` wraps `can()`; `scopeResolver` reads `clientId`/`projectId` from `req.params`, or, where the check needs a loaded document (ticket environment, project→client), resolves after the service loads it — same pattern as today's post-load ownership checks. `requireRole` is fully retired, not left running alongside the new check (mixing flat and scoped checks in the same codebase is exactly what `RBAC.md`'s migration note warns against).

### 5.1 Self-protection

- **Last global admin**: revoking, suspending, or expiring an `AccessAssignment` (or deactivating a `User`) that would leave zero active, non-expired `{ role: 'admin', client: null }` assignments is rejected. Enforced inside a single MongoDB transaction (`session.withTransaction`): check count → apply mutation → recheck count → commit, or roll back. Requires the deployment's MongoDB to run as a replica set (default on Atlas; confirm for self-hosted).
- **No self-escalation**: every grant/modify/revoke of an `AccessAssignment` goes through `canDelegate`, checked against the *requested* target scope and role — not merely the actor's access to the resource being touched.
- **Audit log write** happens inside the same transaction as the mutation — a rolled-back last-admin attempt never produces a log entry. Denied *attempts* (not committed mutations) are not logged in Phase 1 — that's an intrusion-monitoring concern, not an admin audit trail, and stays out of scope.

## 6. Security invariants

Non-negotiable, not implementation suggestions:

1. Default deny — a new user has zero `AccessAssignment`s.
2. Every protected API endpoint performs server-side authorization; frontend visibility is UX only.
3. Client isolation is enforced server-side on every query (list, detail, count, search, export) that touches client-owned data.
4. A `project` scope can never escape its `client` — caller-supplied `clientId` is always resolved against the project's actual client, never trusted.
5. Environment restrictions apply to environment-bearing resources (tickets); empty `environments` means no access to them, not all.
6. Suspended assignments grant no access.
7. Expired assignments grant no access.
8. A user cannot grant a permission they don't themselves hold at a scope containing the request.
9. A user cannot grant a role whose permission bundle exceeds what they can delegate.
10. A project-scoped assignment cannot grant client-wide or global access.
11. A client-scoped assignment cannot grant global access.
12. The final global admin assignment cannot be removed.
13. `AuditLog` is append-only — no update or delete route exists for it.
14. Authorization never depends on frontend visibility.
15. IDs supplied by the client are always resolved and scope-validated server-side.

## 7. API

- `POST/GET/PATCH /v1/clients`, `GET /v1/clients/:id` — `clients.manage` (mutations) / `clients.view` (reads, scope-filtered to the caller's effective clients).
- `GET /v1/projects` — filtered to the caller's effective client/project access (via `Project.client`).
- `POST /v1/access-assignments` (grant), `PATCH /v1/access-assignments/:id` (modify), `DELETE /v1/access-assignments/:id` (revoke) — all through `canDelegate`.
- `GET /v1/access-assignments?userId=` — a user's own effective access list, powers the Access Profile UI.
- `GET /v1/audit-log?actor=&client=&project=&action=&from=&to=` — paginated — `audit.view`.
- Existing `requireRole` call sites in `users.route.js`, `teams.route.js`, `projects.route.js`, `tickets.route.js` are replaced with `requirePermission(...)`, one route at a time, each fully cut over in the same change (never partially migrated).

## 8. UI (Phase 1 only)

- **Clients** page: list/create/edit, reusing existing Teams/Projects card and table patterns.
- **Users & Access**: extends the existing `users/page.jsx` with an Access Profile drawer (readable assignment list — role, client, project, environments) and a step-based Grant Access flow (user → client → project → role → environments → review/confirm).
- **Audit Log** page: filterable, paginated table. No export, no analytics.
- Deferred: Access Matrix grid, Roles & Permissions editor, Access Requests, Access Reviews.

## 9. Deferred sub-projects and how Phase 1 supports them

Ordered, with what Phase 1 gives each of them to build on:

| Sub-project | Depends on Phase 1 for |
|---|---|
| Dynamic ticket configuration | `Client`/`Project` scoping to attach config-inheritance to |
| Client Portal (external auth) | `Client` entity + scoped authorization to restrict external users to their own client |
| Custom fields | The config-inheritance pattern from dynamic ticket configuration |
| Access Requests / Reviews / JIT | `AccessAssignment.expiresAt` (already schema-ready) and `AuditLog` |
| SSO/SCIM/MFA | Existing auth module, unaffected by this design |

## 10. Migration

1. **Dry run**: script reports what it *would* create — one `Client` per distinct existing `Project.brand` value, one global `AccessAssignment` per existing `User` (`role: user.role, client: null, project: null, environments: ['Development','Staging','Production']`) — without writing anything.
2. **Apply**: creates the `Client` docs, sets `Project.client` accordingly, creates the migrated `AccessAssignment`s. Documented explicitly as **transitional** — this preserves every existing user's current unrestricted access so nobody is locked out at cutover; admins narrow access afterward through the Grant Access UI.
3. **Cutover**: `requireRole` call sites replaced route-by-route with `requirePermission`/`can()`, each route fully migrated in the same change.
4. New users from this point forward get zero assignments (default deny).

## 11. Testing

- Unit tests for `can()`/`canDelegate()`: union-of-active-assignments, suspended/expired exclusion, empty-environments-means-none, client/project mismatch rejection, scope+permission containment (including escalation-prevention cases), last-admin transaction rollback.
- Integration tests hit real routes via the existing `mongodb-memory-server` pattern, confirming enforcement at the HTTP layer, not just the unit-level function.
- Migration script tested against a snapshot of representative existing data (varied `brand` values, all five roles) in dry-run mode before any apply-mode test.
