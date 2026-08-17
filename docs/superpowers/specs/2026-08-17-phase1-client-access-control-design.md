# Phase 1: Client Entity + Internal Access-Control Core — Design

Status: approved design, not yet implemented.
See [`Agent Context/RBAC.md`](../../Agent%20Context/RBAC.md), [`PROJECT_MODEL.md`](../../Agent%20Context/PROJECT_MODEL.md), [`PRODUCT_PRINCIPLES.md`](../../Agent%20Context/PRODUCT_PRINCIPLES.md), and [`SECURITY.md`](../../Agent%20Context/SECURITY.md) for the current-state analysis this design builds on.

## 1. Why, and why this scope

Today, authorization is a single flat `User.role` (`admin|lead|qa|developer|member`) enforced by `requireRole()` — every admin can act on every project, there is no client/project/environment boundary, and there is no audit trail of who granted or changed access (`SECURITY.md` gap #2, #1). This PMS is being used by one service company to run projects for multiple external clients, and access needs to be scoped per client/project/environment, with production access never implicitly inherited.

The full ask (external client login/portal, dynamic ticket configuration, custom fields, access requests/reviews, SSO/MFA) is six separable projects, not one. This spec covers only the foundation everything else depends on: a real `Client` entity and an internal, scoped, auditable authorization core. See [§9 Deferred sub-projects](#9-deferred-sub-projects-and-how-phase-1-supports-them) for the rest and their intended order.

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

Deferred, not rejected — see [§9](#9-deferred-sub-projects-and-how-phase-1-supports-them) for why this foundation supports them without a rewrite: client portal / external auth, dynamic ticket types/priorities/labels/environments, custom fields, workflow builder, Access Matrix, Roles & Permissions editor, Access Requests, Access Reviews, JIT access, SSO/SCIM/MFA, audit-log export/analytics.

## 4. Data model

### 4.1 `Client` (new collection)

| Field | Type | Notes |
|---|---|---|
| `name` | String, required, trimmed | Replaces `Project.brand` as the real client grouping. **Partial unique index** on `name` with `partialFilterExpression: { status: 'active' }` — atomic at the DB level (a service-layer preflight check alone is a TOCTOU race between two concurrent creates), while still letting an archived client's name be reused by a new one |
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
| `environments` | `[String]`, enum `ENVIRONMENTS`, deduplicated, default `[]` | Empty = no access to environment-bearing actions (tickets), not "all" — must be listed explicitly. Stores plain string identifiers, so Phase 2 replacing the static `ENVIRONMENTS` registry with a dynamic per-client one doesn't change this field's shape |
| `status` | enum `active`\|`suspended`\|`revoked`, default `active`, indexed | Matches this codebase's existing convention (`User`, `Team`, `Project` all use a status enum, never a hard delete/`deletedAt`) — `DELETE /v1/access-assignments/:id` sets `status: 'revoked'` rather than removing the document |
| `expiresAt` | Date, default `null`, must be `> now` (server clock) at creation | Schema-ready for future time-bound access; no expiry *workflow* in Phase 1, just the field and its enforcement in `can()`. `now` is always generated server-side, never accepted from the client |
| `grantedBy` | ObjectId → User, required | |
| `reason` | String | **Required** when revoking, suspending, or when `environments` includes `Production` — optional otherwise |
| `timestamps` | — | |

Indexes: compound `{ user: 1, status: 1 }`, `{ client: 1, project: 1, status: 1 }`; sparse `{ expiresAt: 1 }` (supports future expiry-sweep/reporting queries; most documents have `expiresAt: null` in Phase 1).

`ENVIRONMENTS` (`@pms/shared/enums.js`) expands from `['Staging','Production']` to `['Development','Staging','Production']` — `Ticket.environment` keeps using the same enum, unchanged shape.

**Global scope never implies environment access.** `client: null, project: null` (global) and `environments: []` are independent axes — a global `admin` assignment with `environments: []` can manage every client/project/user/team but cannot view or touch a single ticket, because environment access is always checked on its own, never inferred from how broad the client/project scope is. The Phase 1 migration avoids this trap by setting migrated assignments' `environments` explicitly (§10) rather than leaving them empty — but a *new* global grant created after migration could legitimately end up in this state, and that's correct behavior, not a bug, as long as it's not silently misread as "global means all-powerful."

**Duplicate assignments** (same user/role/client/project/environments) aren't hard-prevented by a schema constraint — the union-of-active-assignments model makes a duplicate harmless (redundant, not incorrect), and adding a meaningful uniqueness constraint over an array field is more complexity than the actual risk (data clutter, not a security issue) justifies. The Grant Access UI pre-checks for an identical active assignment and offers to edit it instead of creating a second one.

### 4.3 `AuditLog` (new collection, append-only)

| Field | Type | Notes |
|---|---|---|
| `actor` | ObjectId → User, required | |
| `action` | String enum, required, indexed | `ACCESS_GRANTED`, `ACCESS_MODIFIED`, `ACCESS_SUSPENDED`, `ACCESS_REACTIVATED`, `ACCESS_REVOKED`, `CLIENT_CREATED`, `CLIENT_UPDATED`, `CLIENT_ARCHIVED`, `CLIENT_REACTIVATED`, `USER_SUSPENDED`, `USER_REACTIVATED`. (No `ACCESS_EXPIRED` — expiry is a passive time-based state checked at query time in Phase 1, not a sweep job that could log a transition; nothing "does" an expiry event yet. No `PROJECT_CLIENT_CHANGED` — reassigning a project to a different client isn't an operation this design exposes) |
| `targetType` / `targetId` | String / ObjectId | e.g. `'AccessAssignment'` / its id |
| `client` / `project` | ObjectId → Client/Project, nullable | |
| `before` / `after` | Mixed | Snapshot of the changed fields only |
| `reason` | String | |
| `requestId` | String | Correlates with the existing `X-Request-Id` (`platform/requestId.js`) |
| `createdAt` | Date, indexed | No `updatedAt` — the collection is never updated |

Indexes: `{ actor: 1, createdAt: -1 }`, `{ client: 1, createdAt: -1 }`, `{ targetType: 1, targetId: 1 }` (audit history for one specific assignment/client/user), `action`. No update/delete route is ever exposed for this collection.

**Tamper resistance, layered**: application — no update/delete API; service — the repository exposes only an insert operation for this collection, no update/delete method exists to call; tests — assert the repository has no update/delete path. This is process-level integrity, not cryptographic immutability — a compromised DB admin could still edit the collection directly. An external immutable sink (SIEM/log-forwarding) and a retention policy are future governance concerns, out of scope here.

**Every access/role/client mutation writes its `AuditLog` entry inside the same transaction as the mutation itself** — not just the last-admin case in §5.1. If the audit insert fails, the transaction rolls back and the mutation never took effect; there is no path where a grant/revoke/modify commits without a corresponding audit record.

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
async function resolveScope({ projectId, clientId }) {
  if (!projectId) return { clientId: clientId ?? null, projectId: null, archived: false };
  const project = await Project.findById(projectId).select('client status');
  if (!project) throw new NotFoundError();
  if (clientId && String(project.client) !== String(clientId)) {
    throw new ForbiddenError('client/project scope mismatch');
  }
  const client = await Client.findById(project.client).select('status');
  return {
    clientId: project.client,
    projectId: project.id,
    archived: project.status === 'archived' || client?.status === 'archived',
  };
}

async function can(user, permission, { projectId, clientId, environment } = {}) {
  if (user.status !== 'active') return false;
  if (ENVIRONMENT_SCOPED_PERMISSIONS.has(permission) && !environment) {
    throw new Error(`can(): '${permission}' is environment-scoped and requires one`);
  }
  const scope = await resolveScope({ projectId, clientId });
  if (scope.archived && !permission.endsWith('.view')) return false;
  const assignments = await activeAssignmentsFor(user.id);
  const matching = assignments.filter(a => matchesScope(a, { ...scope, environment }));
  return matching.some(a => ROLE_PERMISSIONS[a.role].includes(permission));
}

function matchesScope(a, { clientId, projectId, environment }) {
  if (a.client && String(a.client) !== String(clientId)) return false;
  if (a.project && String(a.project) !== String(projectId)) return false;
  if (environment && !a.environments.includes(environment)) return false;
  return true;
}

async function canDelegate(actor, { permission, role, clientId, projectId, environments = [] }) {
  // `permission` is always 'access.grant' or 'access.revoke', fixed by the calling route
  // handler — never read from the request body, which only ever supplies role/scope.
  if (actor.status !== 'active') return false;
  const scope = await resolveScope({ projectId, clientId });
  const assignments = await activeAssignmentsFor(actor.id);
  const containing = assignments.filter(a => containsScope(a, { ...scope, environments }));
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

`activeAssignmentsFor()` filters `status: 'active'` and (`expiresAt: null` OR `expiresAt > new Date()` — always the server's clock, never client-supplied).

**Canonical scope resolution is structural, not a caller convention**: `resolveScope()` is the *only* way `can()`/`canDelegate()` ever obtain a `clientId` — when a `projectId` is given, its `clientId` always comes from the loaded `Project`, and a separately-supplied `clientId` that disagrees is rejected inside `resolveScope()` itself, before any assignment matching runs. A route handler can no longer authorize against an attacker-controlled `clientId` by forgetting to cross-check it, because there's nothing left for it to forget — the primitive both callers share does it once.

**Environment-scoped permissions must supply an environment**: `ENVIRONMENT_SCOPED_PERMISSIONS = new Set(['tickets.view','tickets.create','tickets.update','tickets.delete','tickets.assign'])`. Calling `can()` for one of these without an `environment` throws — a caller bug, never a silent allow. This is what actually closes the empty-environment gap: `canDelegate`'s containment check intentionally skips environment comparison when `target.environments` is empty, but that's safe by construction — an `AccessAssignment` created with `environments: []` already grants zero ticket access per §4.2, so there's no path where an empty-environment delegation does anything with `tickets.*`. The real fix is making every environment-bearing *check* require a real environment, not adding a redundant check to the delegation side.

**Archived scope**: if the resolved client or project is `archived`, every permission other than a `.view` one is denied — no new grants, no new projects, no ticket mutations under an archived client/project. Historical reads remain available.

**Why `canDelegate` prevents escalation without special-casing**: "only a global admin can grant global admin" is not a coded special case — it falls out of `containsScope`, since only a `client: null` assignment can ever contain another `client: null` request. `admin` is Phase 1's highest-privilege role by construction (holds every permission, and a global `admin` assignment's scope contains every other scope) — stated explicitly here so it isn't mistaken for just another business role later.

Route middleware: `requirePermission(permission, scopeResolver)` wraps `can()`; `scopeResolver` reads `clientId`/`projectId` from `req.params`, or, where the check needs a loaded document (ticket environment, project→client), resolves after the service loads it — same pattern as today's post-load ownership checks. `requireRole` is fully retired, not left running alongside the new check (mixing flat and scoped checks in the same codebase is exactly what `RBAC.md`'s migration note warns against).

**Request pipeline order**, so a future change can't accidentally skip a layer: authenticate → resolve resource/scope → `can()`/`canDelegate()` → ownership/business check (§4.5) → mutation → audit write.

**No caching in Phase 1**: every check is an authoritative DB read. Deliberate — permission caching is deferred until profiling actually shows it's needed, specifically to avoid a stale-permission bug from a cache someone adds later without also wiring invalidation on every assignment mutation. A revocation is effective on the *next* request, immediately — never delayed by a cache TTL.

**Authorization is checked once, at request start.** `can()`/`canDelegate()` run before the mutation/query executes; Phase 1 has no long-running privileged operation (bulk export, background job) where access could plausibly change mid-flight, so a second check partway through isn't built. If one is introduced later, it re-checks `can()` at its resumption point rather than assuming the request-start check still holds — noted here so it isn't silently assumed to already be handled.

**Fail closed, always**: a missing assignment, a malformed scope, an unrecognized role/environment value, an inactive user, an archived client/project, or an unexpected error inside `can()`/`canDelegate()`/`resolveScope()` (a DB timeout, for instance) all produce a **deny** — never a permissive fallback. Concretely: these functions either return `false`/throw; the route middleware treats *any* thrown error, expected or not, as a rejection (403/500), never as an implicit allow. `ROLE_PERMISSIONS[a.role]` should never be `undefined` in practice (Joi validation only ever persists a value from `ROLES`), but if it somehow were, that resolves to an empty permission set, not a crash-to-allow.

### 5.1 Self-protection

- **Last global admin**: revoking, suspending, or expiring an `AccessAssignment` (or deactivating a `User`) that would leave zero active, non-expired `{ role: 'admin', client: null }` assignments is rejected. Enforced inside a MongoDB transaction with `snapshot` read concern / `majority` write concern (`session.withTransaction`): check count → apply mutation → recheck count → commit, or roll back. Two concurrent transactions that both read the same pre-mutation count and each try to remove a *different* global admin will conflict — Mongo aborts one with a `WriteConflict`; the service layer retries that transaction (which then correctly observes zero-remaining and rejects) rather than swallowing the error, so the two requests can never both commit into zero admins. Requires the deployment's MongoDB to run as a replica set (default on Atlas; confirm for self-hosted).
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
16. An archived `Client` or `Project` blocks every mutation permission (grants, creation, ticket writes) scoped under it; `.view` permissions and historical reads remain available.
17. External/client-portal identities, when built, never inherit the internal `ROLE_PERMISSIONS` bundle — they get their own role family from day one.
18. A global or client-wide scope on an assignment never implies environment access — `environments` is checked independently, at every scope breadth, with no exception for `client: null`.
19. Any authorization-path failure (DB error, malformed scope, unrecognized role/environment) resolves to deny — never a fallback allow.

## 7. API

- `POST/GET/PATCH /v1/clients`, `GET /v1/clients/:id` — `clients.manage` (mutations) / `clients.view` (reads, scope-filtered to the caller's effective clients).
- `GET /v1/projects` — filtered to the caller's effective client/project access (via `Project.client`).
- `POST /v1/access-assignments` (grant), `PATCH /v1/access-assignments/:id` (modify), `DELETE /v1/access-assignments/:id` (**logical revoke** — sets `status: 'revoked'`, per §4.2, never removes the document) — all through `canDelegate`. Joi validation on the body: `role` ∈ `ROLES`, `environments` ∈ `ENVIRONMENTS` (deduplicated), `client`/`project`/`user` exist and are `active`, `expiresAt` (if present) `> now`, `reason` required per §4.2's rule. Rate-limited via the existing `express-rate-limit` infra (`platform/rateLimit.js`), consistent with the login/invite limiters already in place — these routes are a privilege-escalation control plane if an admin session is ever compromised.
- `GET /v1/access-assignments?userId=` — powers the Access Profile UI. A caller querying their **own** `userId` always succeeds (self-service "what do I have access to"); querying anyone else's requires `access.view` at a scope containing at least one of the target's assignments — in Phase 1 that means only global admins (the only role holding `access.view`) can view another user's access, matching today's behavior where any admin already sees everything.
- `GET /v1/audit-log?actor=&client=&project=&action=&from=&to=` — paginated — `audit.view`.
- Existing `requireRole` call sites in `users.route.js`, `teams.route.js`, `projects.route.js`, `tickets.route.js` are replaced with `requirePermission(...)`, one route at a time, each fully cut over in the same change (never partially migrated).

## 8. UI (Phase 1 only)

- **Clients** page: list/create/edit, reusing existing Teams/Projects card and table patterns.
- **Users & Access**: extends the existing `users/page.jsx` with an Access Profile drawer (readable assignment list — role, client, project, environments) and a step-based Grant Access flow (user → client → project → role → environments → review/confirm).
- **Audit Log** page: filterable, paginated table. No export, no analytics.
- Global scope (`client: null` / `project: null`) always renders as an explicit label — "All Clients" / "All Projects" — never a blank cell or raw `null`. It's the highest-privilege grant in the system; it should read as obviously as it is.
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

**Guardrail for the Client Portal specifically**: when external/client-portal identities (`User.kind: 'reporter'`) are built, they get their own role family and permission bundle (e.g. `client-admin`/`client-member`) — never reuse or default into the internal `ROLE_PERMISSIONS` map. `AccessAssignment.role` validation should be prepared to branch on `user.kind` once external identities exist, so a client contact can never end up with, say, `member`'s internal ticket-management permissions by accident.

## 10. Migration

Data migration and enforcement cutover are **two separate, independently reversible steps** — not one irreversible deployment:

1. **Dry run**: script reports what it *would* create — one `Client` per distinct existing `Project.brand` value, one global `AccessAssignment` per existing `User` (`role: user.role, client: null, project: null, environments: ['Development','Staging','Production']`) — without writing anything. The report breaks this down by role and resulting environment access (e.g. "4 admins, 18 developers, 12 qa, 13 members — all 47 users temporarily retain Production access post-migration"), so the operational risk is visible before anyone approves it, not discovered after.
2. **Inspect + backup**: the dry-run output is reviewed by an admin; a database backup/snapshot is taken immediately before the apply step, specifically so the apply step can be undone if the generated `Client`/`AccessAssignment` data turns out wrong.
3. **Apply**: creates the `Client` docs, sets `Project.client` accordingly, creates the migrated `AccessAssignment`s. At this point `requireRole` is **still** the live enforcement mechanism — the new data exists but authorizes nothing yet, so a bad migration run is a data-cleanup problem, not an outage or a security incident.
4. **Enforcement cutover**, only after step 3 is verified: `requireRole` call sites replaced route-by-route with `requirePermission`/`can()`, each route fully migrated in the same change. Because this is a separate step from data creation, cutover can proceed gradually (or be reverted route-by-route) without touching the migrated data.
5. New users from this point forward get zero assignments (default deny).
6. **Access review, operationally required, not a built feature**: immediately after cutover, an admin reviews the dry-run report and narrows access — starting with Production — through the Grant Access / modify-assignment UI. This is a rollout checklist item, not Phase 2's Access Reviews feature; nothing new is built for it.

## 11. Testing

- Unit tests for `can()`/`canDelegate()`: union-of-active-assignments, suspended/expired exclusion, empty-environments-means-none, client/project mismatch rejection, global scope not implying environment access, last-admin transaction rollback, every fail-closed case from §6 invariant 19 (DB error, malformed scope, unrecognized role/environment).
- `canDelegate()` boundary tests, specifically: a project-scoped actor cannot grant client-wide access; a client-scoped actor cannot grant a *different* client access; an actor cannot grant a permission they don't themselves hold; `qa`/`developer`/`member` cannot grant `admin`; an actor cannot grant `Production` environment access without holding it themselves at a containing scope; an actor cannot modify/revoke an assignment outside their own delegation scope.
- Integration tests hit real routes via the existing `mongodb-memory-server` pattern, confirming enforcement at the HTTP layer, not just the unit-level function. Every new/modified endpoint gets a negative cross-client test: authenticate as a user scoped to Client A, attempt to read/list/modify a Client B resource by ID, assert rejection — covering direct ID substitution, not just missing-permission cases.
- Migration script tested against a snapshot of representative existing data (varied `brand` values, all five roles) in dry-run mode before any apply-mode test.
- Concurrency integration test: two global admins, simultaneous requests each revoking the other — exactly one commits, one global admin always remains; the losing request observes the retry-and-reject path (§5.1), never a silent double-success that leaves zero admins.
