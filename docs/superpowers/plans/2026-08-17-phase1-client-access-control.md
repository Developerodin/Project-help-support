# Phase 1: Client Entity + Internal Access-Control Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `User.role` authorization model with a scoped `Client → Project → Environment` access-control core (`Client`, `AccessAssignment`, `AuditLog`), migrate existing users/projects into it, and cut every existing route over to it — without building the client portal, dynamic ticket config, or governance features (those are later specs).

**Architecture:** Two new module directories — `backend/src/modules/clients/` (Client CRUD, mirrors the existing teams/projects/users vertical-slice pattern) and `backend/src/modules/access/` (AccessAssignment, AuditLog, the last-admin counter). A new `backend/src/platform/authorize.js` provides `can()`/`canDelegate()`/`effectiveScope()`, consumed by route middleware (`requirePermission`, added to the existing `platform/auth.js`) and directly by `ticket.service.js`'s existing ownership checks. `requireRole` is retired route-by-route, not left running alongside the new checks.

**Tech Stack:** Node.js (ESM), Express 4, Mongoose 8.9, Joi, `node:test` + `node:assert/strict`, `mongodb-memory-server` (standalone for existing tests, a new `MongoMemoryReplSet`-based helper for this module's transactional tests), Next.js App Router frontend.

**Spec:** `docs/superpowers/specs/2026-08-17-phase1-client-access-control-design.md` — this plan implements it; read both together. Deviations from the spec's literal pseudocode, and why, are called out inline where they occur (Task 5's counter mechanism is the main one — the spec's "transaction wrapping a count check" doesn't actually create a write conflict between two concurrent removals of *different* admin assignments; an atomic single-document counter does).

## Global Constraints

- **ESM everywhere** — `import`/`export`, `.js` extensions on relative imports, `type: "module"` in both `backend/package.json` and this plan's new files.
- **`ApiError(statusCode, code, message, fields?)`** from `backend/src/platform/errors.js` for every thrown error — never a bare `Error` in a route/service path.
- **`catchAsync(fn)`** wraps every controller export — Express 4 does not catch rejected promises.
- **Actor from `req.user`, never from the request body** — every controller passes `req.user` explicitly to its service function.
- **Joi validation objects** are `{ params?, query?, body? }`, passed to `validate(schema)`; unknown keys are rejected (`allowUnknown: false` is the `validate()` default) — a stray `role: "admin"` in a body is a 400, not a silently-dropped key.
- **`objectId` Joi helper**: `Joi.string().hex().length(24)`, redeclared per validation file (matches existing convention — no shared Joi-helpers module exists yet, don't introduce one for this).
- **Every schema runs `schema.plugin(toJSON)`** (`backend/src/platform/toJSON.plugin.js`) — `_id` → `id`, `__v` stripped, any `{ private: true }` path stripped.
- **Status-enum lifecycle, never hard delete** — matches `User`/`Team`/`Project`'s existing convention; `AccessAssignment.status` gains `revoked` for exactly this reason (§4.2 of the spec).
- **Tests**: `node --test "**/*.test.js"` (from `backend/package.json`), files under `__tests__/`, `node:test` + `node:assert/strict`, no mocking framework in use anywhere in this codebase — real Mongo via `mongodb-memory-server`.
- **No new dependencies** — `mongodb-memory-server` already provides `MongoMemoryReplSet` (confirmed present in `node_modules/mongodb-memory-server-core`); nothing else this plan needs is missing from `backend/package.json`.

---

## Task 1: Shared permission registry + environment enum expansion

**Files:**
- Create: `shared/permissions.js`
- Modify: `shared/enums.js:24` (ENVIRONMENTS)
- Modify: `shared/index.js`
- Test: `shared/__tests__/permissions.test.js`

**Interfaces:**
- Produces: `PERMISSIONS: string[]`, `ROLE_PERMISSIONS: Record<Role, string[]>` — every later backend task imports `ROLE_PERMISSIONS` from `@pms/shared`.

- [ ] **Step 1: Write the failing test**

```js
// shared/__tests__/permissions.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLES, ENVIRONMENTS } from '../index.js';

test('every role maps to a subset of the permission registry', () => {
  for (const role of ROLES) {
    assert.ok(Array.isArray(ROLE_PERMISSIONS[role]), `${role} has a permission bundle`);
    for (const permission of ROLE_PERMISSIONS[role]) {
      assert.ok(PERMISSIONS.includes(permission), `${permission} (role ${role}) is a real permission`);
    }
  }
});

test('admin holds every permission', () => {
  assert.deepEqual([...ROLE_PERMISSIONS.admin].sort(), [...PERMISSIONS].sort());
});

test('qa, developer and member share the same bundle', () => {
  assert.deepEqual(ROLE_PERMISSIONS.qa, ROLE_PERMISSIONS.developer);
  assert.deepEqual(ROLE_PERMISSIONS.developer, ROLE_PERMISSIONS.member);
});

test('lead can assign tickets and manage teams but not manage users or access', () => {
  assert.ok(ROLE_PERMISSIONS.lead.includes('tickets.assign'));
  assert.ok(ROLE_PERMISSIONS.lead.includes('teams.manage'));
  assert.ok(!ROLE_PERMISSIONS.lead.includes('users.manage'));
  assert.ok(!ROLE_PERMISSIONS.lead.includes('access.grant'));
});

test('ENVIRONMENTS now includes Development alongside the existing two', () => {
  assert.deepEqual(ENVIRONMENTS, ['Development', 'Staging', 'Production']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- --test-name-pattern="permission"` (run from repo root: `node --test shared/__tests__/permissions.test.js`)
Expected: FAIL — `shared/permissions.js` does not exist, `ENVIRONMENTS` still two values.

- [ ] **Step 3: Write minimal implementation**

```js
// shared/enums.js — replace line 24 only, everything else in the file is unchanged
/** Aligned with Dharwin devTicket.model.js environment enum, plus Development for the Phase 1 access-control scope model. */
export const ENVIRONMENTS = Object.freeze(['Development', 'Staging', 'Production']);
```

```js
// shared/permissions.js
/**
 * Centralized permission registry — Phase 1 keeps this a static, code-defined
 * map (not a DB collection). "Avoid hundreds of custom roles; prefer a small
 * number of system roles + scoped access" — see the design spec §4.4/§4.5.
 * Roles stay the five that already exist on User.role; scope (client/project/
 * environment) is what makes a grant specific, not the role name.
 */
export const PERMISSIONS = Object.freeze([
  'clients.view', 'clients.manage',
  'projects.view', 'projects.manage',
  'teams.view', 'teams.manage',
  'tickets.view', 'tickets.create', 'tickets.update', 'tickets.delete', 'tickets.assign',
  'users.view', 'users.manage',
  'access.view', 'access.grant', 'access.revoke',
  'audit.view',
]);

const BASE = Object.freeze([
  'clients.view', 'projects.view', 'teams.view',
  'tickets.view', 'tickets.create', 'tickets.update',
]);

const LEAD = Object.freeze([...BASE, 'teams.manage', 'tickets.assign']);

export const ROLE_PERMISSIONS = Object.freeze({
  admin: PERMISSIONS,
  lead: LEAD,
  qa: BASE,
  developer: BASE,
  member: BASE,
});
```

```js
// shared/index.js — add one line
export * from './enums.js';
export * from './notification-events.js';
export * from './stages.js';
export * from './module-catalog.js';
export * from './permissions.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test shared/__tests__/permissions.test.js shared/__tests__/enums.test.js`
Expected: PASS — including the pre-existing `enums.test.js`, to confirm the `ENVIRONMENTS` change didn't break its existing assertions (read it first if it hard-codes the old two-value array; update it to expect three values if so, in this same step).

- [ ] **Step 5: Commit**

```bash
git add shared/permissions.js shared/enums.js shared/index.js shared/__tests__/permissions.test.js shared/__tests__/enums.test.js
git commit -m "feat(shared): add permission registry and role bundles, expand ENVIRONMENTS"
```

---

## Task 2: Client model + Project.client field

**Files:**
- Create: `backend/src/modules/clients/client.model.js`
- Create: `backend/src/modules/clients/__tests__/client.model.test.js`
- Modify: `backend/src/modules/projects/project.model.js`

**Interfaces:**
- Produces: `Client` (default export of `client.model.js`) — `{ id, name, status, createdBy, createdAt, updatedAt }`.
- Produces: `Project.client` (`ObjectId | null`, ref `Client`) — consumed by every later task that touches Project.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/clients/__tests__/client.model.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import Client from '../client.model.js';

withMemoryDb();

const creator = () => new mongoose.Types.ObjectId();

test('creates a client with default active status', async () => {
  const client = await Client.create({ name: 'Acme', createdBy: creator() });
  assert.equal(client.status, 'active');
  assert.equal(client.toJSON().id, String(client._id));
  assert.equal(client.toJSON()._id, undefined);
});

test('two active clients cannot share a name', async () => {
  await Client.create({ name: 'Acme', createdBy: creator() });
  await assert.rejects(
    () => Client.create({ name: 'Acme', createdBy: creator() }),
    (err) => err.code === 11000,
  );
});

test('an archived client frees its name for a new client to reuse', async () => {
  const first = await Client.create({ name: 'Acme', createdBy: creator() });
  first.status = 'archived';
  await first.save();

  const second = await Client.create({ name: 'Acme', createdBy: creator() });
  assert.equal(second.name, 'Acme');
});

test('name is required', async () => {
  await assert.rejects(() => Client.create({ createdBy: creator() }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/clients/__tests__/client.model.test.js`
Expected: FAIL — cannot find `../client.model.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/modules/clients/client.model.js
import mongoose from 'mongoose';
import toJSON from '../../platform/toJSON.plugin.js';

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

// Atomic at the DB level — a service-layer preflight query alone is a TOCTOU
// race between two concurrent creates of the same name. partialFilterExpression
// scopes uniqueness to active clients only, so an archived client's name can
// be reused by a later one.
clientSchema.index(
  { name: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);

clientSchema.plugin(toJSON);

const Client = mongoose.model('Client', clientSchema);
export default Client;
```

Modify `backend/src/modules/projects/project.model.js` — add one field after `brand` (line 40), NOT `required` at the schema level (existing documents pre-migration have none yet, and `updateProject`'s partial `$set` patches must not be forced to always resupply it):

```js
    brand: { type: String, required: true, trim: true, index: true, default: 'Uncategorized' },
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null, index: true },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/modules/clients/__tests__/client.model.test.js backend/src/modules/projects/__tests__/project.model.test.js`
Expected: PASS — the existing `project.model.test.js` must still pass unchanged, confirming the additive field didn't break anything.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/clients/client.model.js backend/src/modules/clients/__tests__/client.model.test.js backend/src/modules/projects/project.model.js
git commit -m "feat(clients): add Client model with partial-unique name index; Project gains client ref"
```

---

## Task 3: AccessAssignment model

**Files:**
- Create: `backend/src/modules/access/accessAssignment.model.js`
- Create: `backend/src/modules/access/__tests__/accessAssignment.model.test.js`

**Interfaces:**
- Consumes: `ROLES`, `ENVIRONMENTS` from `@pms/shared` (Task 1).
- Produces: `AccessAssignment` (default export) — `{ id, user, role, client, project, environments, status, expiresAt, grantedBy, reason, createdAt, updatedAt }`. Every later backend task reads/writes this model directly (never through a repository layer — matches this codebase's existing pattern of services calling Mongoose models directly).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/access/__tests__/accessAssignment.model.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import AccessAssignment from '../accessAssignment.model.js';

withMemoryDb();

const id = () => new mongoose.Types.ObjectId();
const base = () => ({ user: id(), role: 'qa', grantedBy: id() });

test('a global assignment (client and project both null) is valid', async () => {
  const a = await AccessAssignment.create(base());
  assert.equal(a.client, null);
  assert.equal(a.project, null);
  assert.equal(a.status, 'active');
  assert.deepEqual(a.environments, []);
});

test('project cannot be set without client', async () => {
  await assert.rejects(() => AccessAssignment.create({ ...base(), project: id() }));
});

test('project is valid when client is also set', async () => {
  const a = await AccessAssignment.create({ ...base(), client: id(), project: id() });
  assert.ok(a.project);
});

test('environments are deduplicated on set', async () => {
  const a = await AccessAssignment.create({
    ...base(), environments: ['Staging', 'Staging', 'Development'],
  });
  assert.deepEqual([...a.environments].sort(), ['Development', 'Staging']);
});

test('an unrecognized environment value is rejected', async () => {
  await assert.rejects(() => AccessAssignment.create({ ...base(), environments: ['QA-Sandbox'] }));
});

test('reason is required when granting Production access', async () => {
  await assert.rejects(
    () => AccessAssignment.create({ ...base(), environments: ['Production'] }),
    (err) => /reason/i.test(err.message),
  );
  const withReason = await AccessAssignment.create({
    ...base(), environments: ['Production'], reason: 'incident response',
  });
  assert.ok(withReason);
});

test('reason is required when suspending or revoking', async () => {
  const active = await AccessAssignment.create(base());
  active.status = 'suspended';
  await assert.rejects(() => active.save());

  active.reason = 'temporary leave';
  await active.save();
  assert.equal(active.status, 'suspended');
});

test('reason is not required for an ordinary active grant with no Production access', async () => {
  const a = await AccessAssignment.create({ ...base(), environments: ['Staging'] });
  assert.equal(a.reason, undefined);
});

test('expiresAt must be in the future when set', async () => {
  await assert.rejects(() => AccessAssignment.create({ ...base(), expiresAt: new Date(Date.now() - 1000) }));
  const a = await AccessAssignment.create({ ...base(), expiresAt: new Date(Date.now() + 86400000) });
  assert.ok(a.expiresAt);
});

test('status accepts revoked, matching this codebase\'s status-enum-not-hard-delete convention', async () => {
  const a = await AccessAssignment.create(base());
  a.status = 'revoked';
  a.reason = 'no longer needed';
  await a.save();
  assert.equal(a.status, 'revoked');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/access/__tests__/accessAssignment.model.test.js`
Expected: FAIL — cannot find `../accessAssignment.model.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/modules/access/accessAssignment.model.js
import mongoose from 'mongoose';
import { ROLES, ENVIRONMENTS } from '@pms/shared';
import toJSON from '../../platform/toJSON.plugin.js';

const objectId = mongoose.Schema.Types.ObjectId;

/**
 * Cross-field validators below read `this.client`/`this.status`/`this.environments`,
 * which only resolves correctly on document-style writes (.create()/.save()) —
 * NOT on findByIdAndUpdate with runValidators. Every service in this module
 * must load-then-save when modifying an existing assignment (see accessAssignment.service.js).
 */
const accessAssignmentSchema = new mongoose.Schema(
  {
    user: { type: objectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ROLES, required: true },
    client: { type: objectId, ref: 'Client', default: null, index: true },
    project: {
      type: objectId,
      ref: 'Project',
      default: null,
      index: true,
      validate: {
        validator() { return this.project == null || this.client != null; },
        message: 'A project-scoped assignment must also have a client',
      },
    },
    environments: {
      type: [{ type: String, enum: ENVIRONMENTS }],
      default: [],
      set: (values) => [...new Set(values)],
    },
    status: { type: String, enum: ['active', 'suspended', 'revoked'], default: 'active', index: true },
    expiresAt: {
      type: Date,
      default: null,
      validate: {
        validator(v) { return v == null || v > new Date(); },
        message: 'expiresAt must be in the future',
      },
    },
    grantedBy: { type: objectId, ref: 'User', required: true },
    reason: {
      type: String,
      trim: true,
      validate: {
        validator(v) {
          const sensitive = this.status !== 'active' || this.environments.includes('Production');
          return !sensitive || Boolean(v && v.trim());
        },
        message: 'A reason is required when revoking, suspending, or granting Production access',
      },
    },
  },
  { timestamps: true },
);

accessAssignmentSchema.index({ user: 1, status: 1 });
accessAssignmentSchema.index({ client: 1, project: 1, status: 1 });
accessAssignmentSchema.index({ expiresAt: 1 }, { sparse: true });

accessAssignmentSchema.plugin(toJSON);

const AccessAssignment = mongoose.model('AccessAssignment', accessAssignmentSchema);
export default AccessAssignment;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/modules/access/__tests__/accessAssignment.model.test.js`
Expected: PASS, all 10 cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/access/accessAssignment.model.js backend/src/modules/access/__tests__/accessAssignment.model.test.js
git commit -m "feat(access): add AccessAssignment model with scope, environment, and reason validators"
```

---

## Task 4: AuditLog model

**Files:**
- Create: `backend/src/modules/access/auditLog.model.js`
- Create: `backend/src/modules/access/__tests__/auditLog.model.test.js`

**Interfaces:**
- Produces: `AuditLog` (default export), `AUDIT_ACTIONS` (named export, string array) — consumed by Task 8 (grant/revoke service) and Task 11 (audit-log query service).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/access/__tests__/auditLog.model.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import AuditLog, { AUDIT_ACTIONS } from '../auditLog.model.js';

withMemoryDb();

const id = () => new mongoose.Types.ObjectId();

test('records a full audit entry', async () => {
  const entry = await AuditLog.create({
    actor: id(),
    action: 'ACCESS_GRANTED',
    targetType: 'AccessAssignment',
    targetId: id(),
    client: id(),
    project: null,
    before: null,
    after: { role: 'qa', environments: ['Staging'] },
    reason: 'QA access required',
    requestId: 'req_123',
  });
  assert.equal(entry.action, 'ACCESS_GRANTED');
  assert.equal(entry.toJSON().id, String(entry._id));
});

test('rejects an action outside the enum', async () => {
  await assert.rejects(() => AuditLog.create({
    actor: id(), action: 'SOMETHING_ELSE', targetType: 'AccessAssignment', targetId: id(),
  }));
});

test('AUDIT_ACTIONS covers the lifecycle actions this module writes', () => {
  for (const action of [
    'ACCESS_GRANTED', 'ACCESS_MODIFIED', 'ACCESS_SUSPENDED', 'ACCESS_REACTIVATED', 'ACCESS_REVOKED',
    'CLIENT_CREATED', 'CLIENT_UPDATED', 'CLIENT_ARCHIVED', 'CLIENT_REACTIVATED',
    'USER_SUSPENDED', 'USER_REACTIVATED',
  ]) {
    assert.ok(AUDIT_ACTIONS.includes(action), action);
  }
});

test('has no updatedAt — the collection is append-only', async () => {
  const entry = await AuditLog.create({
    actor: id(), action: 'CLIENT_CREATED', targetType: 'Client', targetId: id(),
  });
  assert.equal(entry.toJSON().updatedAt, undefined);
  assert.ok(entry.toJSON().createdAt);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/access/__tests__/auditLog.model.test.js`
Expected: FAIL — cannot find `../auditLog.model.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/modules/access/auditLog.model.js
import mongoose from 'mongoose';
import toJSON from '../../platform/toJSON.plugin.js';

export const AUDIT_ACTIONS = Object.freeze([
  'ACCESS_GRANTED', 'ACCESS_MODIFIED', 'ACCESS_SUSPENDED', 'ACCESS_REACTIVATED', 'ACCESS_REVOKED',
  'CLIENT_CREATED', 'CLIENT_UPDATED', 'CLIENT_ARCHIVED', 'CLIENT_REACTIVATED',
  'USER_SUSPENDED', 'USER_REACTIVATED',
]);

const objectId = mongoose.Schema.Types.ObjectId;

/**
 * No update/delete route or service function is ever written for this model —
 * that omission, not a DB-level lock, is the tamper resistance for Phase 1
 * (see the design spec §4.3).
 */
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: objectId, ref: 'User', required: true },
    action: { type: String, enum: AUDIT_ACTIONS, required: true, index: true },
    targetType: { type: String, required: true },
    targetId: { type: objectId, required: true },
    client: { type: objectId, ref: 'Client', default: null },
    project: { type: objectId, ref: 'Project', default: null },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    reason: { type: String },
    requestId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ client: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });

auditLogSchema.plugin(toJSON);

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/modules/access/__tests__/auditLog.model.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/access/auditLog.model.js backend/src/modules/access/__tests__/auditLog.model.test.js
git commit -m "feat(access): add append-only AuditLog model"
```

---

## Task 5: Transaction helper, replica-set test helper, and the global-admin counter

**Why this task exists, and where it deviates from the spec:** the spec (§5.1) describes last-admin protection as "wrap a count-check-then-mutate in a MongoDB transaction." That alone does not work: if Admin A revokes Admin B's assignment and Admin B concurrently revokes Admin A's assignment, each transaction writes to a *different* document — MongoDB's write-conflict detection is per-document, so nothing forces these two transactions to conflict, and both can commit, leaving zero admins. The fix is a single shared counter document that **every** such mutation must atomically touch — that document is what creates a real write conflict between concurrent removals. This task builds that counter, plus the transaction helper and the new replica-set-backed test helper transactions require (`backend/src/platform/__tests__/helpers/memoryDb.js` is explicitly standalone, "no transactions by design" — untouched by this task, used by every other test file in the codebase).

**Files:**
- Create: `backend/src/platform/transaction.js`
- Create: `backend/src/platform/__tests__/helpers/memoryReplSetDb.js`
- Create: `backend/src/modules/access/globalAdminGuard.model.js`
- Create: `backend/src/modules/access/globalAdminGuard.js`
- Create: `backend/src/modules/access/__tests__/globalAdminGuard.test.js`

**Interfaces:**
- Consumes: `AccessAssignment` (Task 3).
- Produces: `withTransaction(fn): Promise<any>` (from `transaction.js`) — consumed by Task 8 (grant/revoke service) and Task 13 (user deactivation guard).
- Produces: `withMemoryReplSetDb(): void` (test-setup side effect, same calling convention as the existing `withMemoryDb()`) — consumed by this task's own test and Task 8's/Task 19's concurrency tests.
- Produces from `globalAdminGuard.js`: `initGlobalAdminCount(count, session)`, `incrementGlobalAdminCount(session)`, `decrementGlobalAdminCount(session)` (throws `ApiError(409, 'LAST_ADMIN_PROTECTED', ...)`), `hasActiveGlobalAdminAssignment(userId, session): Promise<boolean>`, `isActiveGlobalAdmin(assignment): boolean`.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/access/__tests__/globalAdminGuard.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryReplSetDb } from '../../../platform/__tests__/helpers/memoryReplSetDb.js';
import { withTransaction } from '../../../platform/transaction.js';
import {
  initGlobalAdminCount, incrementGlobalAdminCount, decrementGlobalAdminCount,
  hasActiveGlobalAdminAssignment, isActiveGlobalAdmin,
} from '../globalAdminGuard.js';
import AccessAssignment from '../accessAssignment.model.js';

withMemoryReplSetDb();

const id = () => new mongoose.Types.ObjectId();

test('isActiveGlobalAdmin recognizes a global, active, unexpired admin assignment', () => {
  assert.equal(isActiveGlobalAdmin({ role: 'admin', client: null, status: 'active', expiresAt: null }), true);
  assert.equal(isActiveGlobalAdmin({ role: 'admin', client: id(), status: 'active', expiresAt: null }), false);
  assert.equal(isActiveGlobalAdmin({ role: 'lead', client: null, status: 'active', expiresAt: null }), false);
  assert.equal(isActiveGlobalAdmin({ role: 'admin', client: null, status: 'suspended', expiresAt: null }), false);
  assert.equal(
    isActiveGlobalAdmin({ role: 'admin', client: null, status: 'active', expiresAt: new Date(Date.now() - 1000) }),
    false,
  );
});

test('decrement fails once the counter would reach zero', async () => {
  await withTransaction((session) => initGlobalAdminCount(1, session));

  await assert.rejects(
    () => withTransaction((session) => decrementGlobalAdminCount(session)),
    (err) => err.statusCode === 409 && err.code === 'LAST_ADMIN_PROTECTED',
  );
});

test('decrement succeeds when more than one admin remains, and the count reflects it', async () => {
  await withTransaction((session) => initGlobalAdminCount(2, session));
  await withTransaction((session) => decrementGlobalAdminCount(session));

  await assert.rejects(
    () => withTransaction((session) => decrementGlobalAdminCount(session)),
    (err) => err.statusCode === 409,
  );
});

test('two concurrent decrements from a count of 2 leave exactly one admin, never zero', async () => {
  await withTransaction((session) => initGlobalAdminCount(2, session));

  const results = await Promise.allSettled([
    withTransaction((session) => decrementGlobalAdminCount(session)),
    withTransaction((session) => decrementGlobalAdminCount(session)),
  ]);

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;
  assert.equal(succeeded, 1);
  assert.equal(failed, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.code, 'LAST_ADMIN_PROTECTED');
});

test('hasActiveGlobalAdminAssignment reflects real AccessAssignment documents', async () => {
  const user = id();
  await AccessAssignment.create({ user, role: 'admin', grantedBy: id() });

  await withTransaction(async (session) => {
    assert.equal(await hasActiveGlobalAdminAssignment(user, session), true);
    assert.equal(await hasActiveGlobalAdminAssignment(id(), session), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/access/__tests__/globalAdminGuard.test.js`
Expected: FAIL — none of the four new files exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/platform/transaction.js
import mongoose from 'mongoose';

/**
 * The ONLY place in this codebase that uses MongoDB transactions — scoped to
 * the last-global-admin invariant and its audit write (see globalAdminGuard.js
 * and accessAssignment.service.js). Everything else remains transaction-free
 * by design, per backend/src/platform/__tests__/helpers/memoryDb.js.
 */
export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } finally {
    await session.endSession();
  }
}
```

```js
// backend/src/platform/__tests__/helpers/memoryReplSetDb.js
import { before, after, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let currentUri = null;

export function getReplSetUri() {
  return currentUri;
}

/**
 * Call at the top of a test file that needs real MongoDB transactions.
 * Separate from withMemoryDb() (standalone — "no transactions by design",
 * used by every other test file). A 1-member replica set is sufficient for
 * transaction correctness in tests; it is not a production topology.
 */
export function withMemoryReplSetDb() {
  let replSet;

  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    currentUri = replSet.getUri();
    await mongoose.connect(currentUri);
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState !== 1) await mongoose.connect(currentUri);
    const { collections } = mongoose.connection;
    await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  });

  after(async () => {
    await mongoose.disconnect();
    await replSet.stop();
    currentUri = null;
  });
}
```

```js
// backend/src/modules/access/globalAdminGuard.model.js
import mongoose from 'mongoose';

/** Singleton document. Its whole purpose is to be the ONE thing every
 * global-admin-count-changing transaction writes, so concurrent writers
 * genuinely conflict — see globalAdminGuard.js. */
const globalAdminCounterSchema = new mongoose.Schema(
  { _id: { type: String }, count: { type: Number, required: true, min: 0 } },
  { versionKey: false },
);

const GlobalAdminCounter = mongoose.model('GlobalAdminCounter', globalAdminCounterSchema);
export default GlobalAdminCounter;
```

```js
// backend/src/modules/access/globalAdminGuard.js
import { ApiError } from '../../platform/errors.js';
import GlobalAdminCounter from './globalAdminGuard.model.js';
import AccessAssignment from './accessAssignment.model.js';

export const GLOBAL_ADMIN_COUNTER_ID = 'global-admin-count';

export function isActiveGlobalAdmin(assignment) {
  const notExpired = !assignment.expiresAt || assignment.expiresAt > new Date();
  return assignment.role === 'admin' && assignment.client == null
    && assignment.status === 'active' && notExpired;
}

/** Migration-only: sets the counter to a known starting value. */
export async function initGlobalAdminCount(count, session) {
  await GlobalAdminCounter.findOneAndUpdate(
    { _id: GLOBAL_ADMIN_COUNTER_ID },
    { $set: { count } },
    { upsert: true, session },
  );
}

/** Call inside a transaction before a write that creates a new active global admin. */
export async function incrementGlobalAdminCount(session) {
  await GlobalAdminCounter.findOneAndUpdate(
    { _id: GLOBAL_ADMIN_COUNTER_ID },
    { $inc: { count: 1 } },
    { upsert: true, session },
  );
}

/**
 * Call inside a transaction before a write that would deactivate the last
 * active global admin. Atomic single-document conditional update: both
 * writers target the SAME document, so MongoDB's write-conflict detection
 * genuinely serializes them, unlike a plain count-then-write.
 */
export async function decrementGlobalAdminCount(session) {
  const updated = await GlobalAdminCounter.findOneAndUpdate(
    { _id: GLOBAL_ADMIN_COUNTER_ID, count: { $gt: 1 } },
    { $inc: { count: -1 } },
    { new: true, session },
  );
  if (!updated) {
    throw new ApiError(409, 'LAST_ADMIN_PROTECTED', 'At least one global admin must remain');
  }
}

export async function hasActiveGlobalAdminAssignment(userId, session) {
  const now = new Date();
  const found = await AccessAssignment.findOne({
    user: userId, role: 'admin', client: null, status: 'active',
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  }).session(session);
  return Boolean(found);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/modules/access/__tests__/globalAdminGuard.test.js`
Expected: PASS, all 5 cases — including the concurrent-decrement test, which is the one that would have silently passed with a naive count-then-write implementation and must genuinely exercise two `Promise.allSettled` branches with exactly one success.

- [ ] **Step 5: Commit**

```bash
git add backend/src/platform/transaction.js backend/src/platform/__tests__/helpers/memoryReplSetDb.js backend/src/modules/access/globalAdminGuard.model.js backend/src/modules/access/globalAdminGuard.js backend/src/modules/access/__tests__/globalAdminGuard.test.js
git commit -m "feat(access): add transactional last-global-admin counter with real concurrency protection"
```

---

## Task 6: `authorize.js` — resolveScope, can(), effectiveScope()

**Files:**
- Create: `backend/src/platform/authorize.js`
- Create: `backend/src/platform/__tests__/authorize.can.test.js`

**Interfaces:**
- Consumes: `ROLE_PERMISSIONS` (Task 1), `Client` (Task 2), `Project` (existing, now with `.client`), `AccessAssignment` (Task 3).
- Produces: `ENVIRONMENT_SCOPED_PERMISSIONS: Set<string>`, `resolveScope({ projectId?, clientId? }): Promise<{clientId, projectId, archived}>`, `can(user, permission, { projectId?, clientId?, environment? }): Promise<boolean>`, `effectiveScope(userId): Promise<{allClients:true} | {allClients:false, clientIds:string[], projectIds:string[]}>`. Consumed by Task 7 (`canDelegate`, same file), Task 9 (`requirePermission` middleware), Task 16 (`ticket.service.js` cutover), Task 15 (`project.service.js` scoped listing).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/platform/__tests__/authorize.can.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from './helpers/memoryDb.js';
import User from '../../modules/users/user.model.js';
import Client from '../../modules/clients/client.model.js';
import Project from '../../modules/projects/project.model.js';
import AccessAssignment from '../../modules/access/accessAssignment.model.js';
import { can, resolveScope, effectiveScope } from '../authorize.js';

withMemoryDb();

const activeUser = () => User.create({
  name: 'U', email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active',
});
const client = (name = 'Acme') => Client.create({ name, createdBy: new mongoose.Types.ObjectId() });
const project = (clientDoc, key = 'WEB') => Project.create({
  key, name: `${key} App`, client: clientDoc._id, createdBy: new mongoose.Types.ObjectId(),
});

test('resolveScope with no projectId returns the given clientId untouched', async () => {
  const c = await client();
  const scope = await resolveScope({ clientId: c._id });
  assert.equal(String(scope.clientId), String(c._id));
  assert.equal(scope.projectId, null);
});

test('resolveScope derives clientId from the project, ignoring a mismatched caller-supplied clientId', async () => {
  const c = await client();
  const p = await project(c);
  await assert.rejects(
    () => resolveScope({ projectId: p._id, clientId: new mongoose.Types.ObjectId() }),
    (err) => err.statusCode === 403 && err.code === 'SCOPE_MISMATCH',
  );
  const scope = await resolveScope({ projectId: p._id, clientId: c._id });
  assert.equal(String(scope.clientId), String(c._id));
});

test('resolveScope flags an archived client or project', async () => {
  const c = await client();
  const p = await project(c);
  p.status = 'archived';
  await p.save();
  assert.equal((await resolveScope({ projectId: p._id })).archived, true);
});

test('resolveScope throws 404 for a missing project', async () => {
  await assert.rejects(
    () => resolveScope({ projectId: new mongoose.Types.ObjectId() }),
    (err) => err.statusCode === 404,
  );
});

test('can() denies an inactive user regardless of assignments', async () => {
  const u = await User.create({
    name: 'U', email: 'inactive@example.com', password: 'a-long-enough-password', status: 'inactive',
  });
  await AccessAssignment.create({ user: u._id, role: 'admin', grantedBy: u._id });
  assert.equal(await can(u, 'clients.manage', {}), false);
});

test('can() throws for an environment-scoped permission called without an environment', async () => {
  const u = await activeUser();
  await assert.rejects(() => can(u, 'tickets.view', {}));
});

test('a global admin assignment with empty environments cannot view tickets but can manage clients', async () => {
  const u = await activeUser();
  await AccessAssignment.create({ user: u._id, role: 'admin', grantedBy: u._id }); // environments: []
  assert.equal(await can(u, 'clients.manage', {}), true);
  assert.equal(await can(u, 'tickets.view', { environment: 'Staging' }), false);
});

test('a client-scoped assignment grants tickets.view only for its listed environments', async () => {
  const u = await activeUser();
  const c = await client();
  const p = await project(c);
  await AccessAssignment.create({
    user: u._id, role: 'qa', client: c._id, environments: ['Staging'], grantedBy: u._id,
  });

  assert.equal(await can(u, 'tickets.view', { projectId: p._id, environment: 'Staging' }), true);
  assert.equal(await can(u, 'tickets.view', { projectId: p._id, environment: 'Production' }), false);

  const otherClient = await client('Globex');
  const otherProject = await project(otherClient, 'ERP');
  assert.equal(await can(u, 'tickets.view', { projectId: otherProject._id, environment: 'Staging' }), false);
});

test('suspended and expired assignments grant nothing', async () => {
  const u = await activeUser();
  await AccessAssignment.create({
    user: u._id, role: 'admin', status: 'suspended', reason: 'leave', grantedBy: u._id,
  });
  assert.equal(await can(u, 'clients.manage', {}), false);
});

test('archived scope denies mutation but not view', async () => {
  const u = await activeUser();
  const c = await client();
  const p = await project(c);
  p.status = 'archived';
  await p.save();
  await AccessAssignment.create({
    user: u._id, role: 'admin', client: c._id, grantedBy: u._id,
  });

  assert.equal(await can(u, 'projects.manage', { projectId: p._id }), false);
  assert.equal(await can(u, 'projects.view', { projectId: p._id }), true);
});

test('effectiveScope reports allClients for a global assignment', async () => {
  const u = await activeUser();
  await AccessAssignment.create({ user: u._id, role: 'member', grantedBy: u._id });
  assert.deepEqual(await effectiveScope(u._id), { allClients: true });
});

test('effectiveScope resolves the owning client of a project-only-scoped assignment', async () => {
  const u = await activeUser();
  const c1 = await client('Acme');
  const p1 = await project(c1, 'WEB');
  // Only a project-scoped assignment exists — no separate client-level one —
  // so clientIds must come from resolving p1's owning client, not a direct grant.
  await AccessAssignment.create({
    user: u._id, role: 'member', client: c1._id, project: p1._id, grantedBy: u._id,
  });

  const scope = await effectiveScope(u._id);
  assert.equal(scope.allClients, false);
  assert.deepEqual(scope.projectIds, [String(p1._id)]);
  assert.ok(scope.clientIds.includes(String(c1._id)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/platform/__tests__/authorize.can.test.js`
Expected: FAIL — cannot find `../authorize.js`.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/platform/authorize.js
import { ROLE_PERMISSIONS } from '@pms/shared';
import { ApiError } from './errors.js';
import Project from '../modules/projects/project.model.js';
import Client from '../modules/clients/client.model.js';
import AccessAssignment from '../modules/access/accessAssignment.model.js';

export const ENVIRONMENT_SCOPED_PERMISSIONS = new Set([
  'tickets.view', 'tickets.create', 'tickets.update', 'tickets.delete', 'tickets.assign',
]);

/**
 * The ONLY way can()/canDelegate() ever obtain a clientId when a projectId is
 * present — a caller-supplied clientId that disagrees with the project's real
 * client is rejected here, before any assignment matching runs. See design
 * spec §5 "Canonical scope resolution is structural, not a caller convention".
 */
export async function resolveScope({ projectId, clientId } = {}) {
  if (!projectId) return { clientId: clientId ?? null, projectId: null, archived: false };

  const project = await Project.findById(projectId).select('client status');
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  if (clientId && String(project.client) !== String(clientId)) {
    throw new ApiError(403, 'SCOPE_MISMATCH', 'Client/project scope mismatch');
  }

  const client = project.client ? await Client.findById(project.client).select('status') : null;
  return {
    clientId: project.client,
    projectId: project._id,
    archived: project.status === 'archived' || client?.status === 'archived',
  };
}

async function activeAssignmentsFor(userId) {
  const now = new Date();
  return AccessAssignment.find({
    user: userId,
    status: 'active',
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  });
}

function matchesScope(assignment, { clientId, projectId, environment }) {
  if (assignment.client && String(assignment.client) !== String(clientId)) return false;
  if (assignment.project && String(assignment.project) !== String(projectId)) return false;
  if (environment && !assignment.environments.includes(environment)) return false;
  return true;
}

/**
 * Fail-closed by construction: an inactive user, an unmatched scope, or an
 * empty ROLE_PERMISSIONS lookup all fall through to `.some()` returning false,
 * never true. A malformed environment-scoped call throws rather than silently
 * matching everything.
 */
export async function can(user, permission, { projectId, clientId, environment } = {}) {
  if (!user || user.status !== 'active') return false;
  if (ENVIRONMENT_SCOPED_PERMISSIONS.has(permission) && !environment) {
    throw new Error(`can(): '${permission}' is environment-scoped and requires one`);
  }

  const scope = await resolveScope({ projectId, clientId });
  if (scope.archived && !permission.endsWith('.view')) return false;

  const assignments = await activeAssignmentsFor(user._id);
  const matching = assignments.filter((a) => matchesScope(a, { ...scope, environment }));
  return matching.some((a) => (ROLE_PERMISSIONS[a.role] || []).includes(permission));
}

/**
 * Which clients/projects a user has ANY active assignment scoping — a coarse
 * breadth filter for list endpoints (clients, projects, the ticket list),
 * distinct from can()'s per-resource, permission-aware check.
 */
export async function effectiveScope(userId) {
  const assignments = await activeAssignmentsFor(userId);
  if (assignments.some((a) => a.client == null)) return { allClients: true };

  const clientIds = new Set();
  const projectIds = new Set();
  for (const a of assignments) {
    if (a.project == null) clientIds.add(String(a.client));
    else projectIds.add(String(a.project));
  }

  if (projectIds.size) {
    const owningClients = await Project.find({ _id: { $in: [...projectIds] } }).distinct('client');
    owningClients.forEach((cid) => cid && clientIds.add(String(cid)));
  }

  return { allClients: false, clientIds: [...clientIds], projectIds: [...projectIds] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/platform/__tests__/authorize.can.test.js`
Expected: PASS, all 13 cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/platform/authorize.js backend/src/platform/__tests__/authorize.can.test.js
git commit -m "feat(platform): add authorize.js core — resolveScope, can(), effectiveScope()"
```

---

## Task 7: `authorize.js` — canDelegate()

**Files:**
- Modify: `backend/src/platform/authorize.js`
- Create: `backend/src/platform/__tests__/authorize.canDelegate.test.js`

**Interfaces:**
- Consumes: everything from Task 6 (same file).
- Produces: `canDelegate(actor, { permission, role, clientId?, projectId?, environments? }): Promise<boolean>` — consumed by Task 8 (grant/revoke service).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/platform/__tests__/authorize.canDelegate.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from './helpers/memoryDb.js';
import User from '../../modules/users/user.model.js';
import Client from '../../modules/clients/client.model.js';
import Project from '../../modules/projects/project.model.js';
import AccessAssignment from '../../modules/access/accessAssignment.model.js';
import { canDelegate } from '../authorize.js';

withMemoryDb();

const activeUser = () => User.create({
  name: 'U', email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password', status: 'active',
});
const client = (name = 'Acme') => Client.create({ name, createdBy: new mongoose.Types.ObjectId() });
const project = (clientDoc, key = 'WEB') => Project.create({
  key, name: `${key} App`, client: clientDoc._id, createdBy: new mongoose.Types.ObjectId(),
});

test('a global admin can grant admin globally — the base case', async () => {
  const admin = await activeUser();
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });

  assert.equal(await canDelegate(admin, { permission: 'access.grant', role: 'admin' }), true);
});

test('a project-scoped actor cannot grant client-wide access', async () => {
  const actor = await activeUser();
  const c = await client();
  const p = await project(c);
  await AccessAssignment.create({
    user: actor._id, role: 'admin', client: c._id, project: p._id, grantedBy: actor._id,
  });

  assert.equal(
    await canDelegate(actor, { permission: 'access.grant', role: 'member', clientId: c._id }),
    false,
  );
  assert.equal(
    await canDelegate(actor, { permission: 'access.grant', role: 'member', clientId: c._id, projectId: p._id }),
    true,
  );
});

test('a client-scoped actor cannot grant access on a different client', async () => {
  const actor = await activeUser();
  const c1 = await client('Acme');
  const c2 = await client('Globex');
  await AccessAssignment.create({ user: actor._id, role: 'admin', client: c1._id, grantedBy: actor._id });

  assert.equal(
    await canDelegate(actor, { permission: 'access.grant', role: 'member', clientId: c2._id }),
    false,
  );
});

test('an actor cannot grant a permission they do not themselves hold', async () => {
  const actor = await activeUser();
  // lead holds teams.manage but not access.grant.
  await AccessAssignment.create({ user: actor._id, role: 'lead', grantedBy: actor._id });

  assert.equal(await canDelegate(actor, { permission: 'access.grant', role: 'member' }), false);
});

test('qa, developer and member cannot grant admin, even where they hold access.grant hypothetically', async () => {
  const actor = await activeUser();
  await AccessAssignment.create({ user: actor._id, role: 'admin', grantedBy: actor._id });

  // The global admin CAN grant admin (base case above). This test instead
  // proves role-permission containment: a scoped grant of a lesser role
  // cannot in turn delegate admin, because admin's bundle exceeds theirs.
  const scopedLead = await activeUser();
  const c = await client();
  await AccessAssignment.create({
    user: scopedLead._id, role: 'lead', client: c._id, grantedBy: actor._id,
  });
  assert.equal(
    await canDelegate(scopedLead, { permission: 'access.grant', role: 'admin', clientId: c._id }),
    false,
  );
});

test('an actor cannot grant Production access they do not themselves hold', async () => {
  const actor = await activeUser();
  const c = await client();
  await AccessAssignment.create({
    user: actor._id, role: 'admin', client: c._id, environments: ['Development', 'Staging'],
    grantedBy: actor._id,
  });

  assert.equal(
    await canDelegate(actor, {
      permission: 'access.grant', role: 'qa', clientId: c._id, environments: ['Staging'],
    }),
    true,
  );
  assert.equal(
    await canDelegate(actor, {
      permission: 'access.grant', role: 'qa', clientId: c._id, environments: ['Production'],
    }),
    false,
  );
});

test('an inactive actor can never delegate', async () => {
  const actor = await User.create({
    name: 'U', email: 'inactive2@example.com', password: 'a-long-enough-password', status: 'inactive',
  });
  await AccessAssignment.create({ user: actor._id, role: 'admin', grantedBy: actor._id });
  assert.equal(await canDelegate(actor, { permission: 'access.grant', role: 'member' }), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/platform/__tests__/authorize.canDelegate.test.js`
Expected: FAIL — `canDelegate` is not exported yet.

- [ ] **Step 3: Write minimal implementation**

Append to `backend/src/platform/authorize.js` (after `effectiveScope`, same file — `can`/`canDelegate` stay in one module deliberately, per the design spec, so they are never unified into one function later just for code reuse, but they do share `resolveScope`/`activeAssignmentsFor`):

```js
function containsScope(assignment, target) {
  if (assignment.client && String(assignment.client) !== String(target.clientId)) return false;
  // A project-specific assignment can never contain a broader (or different-project) request.
  if (assignment.project && String(assignment.project) !== String(target.projectId)) return false;
  if (target.environments.length
    && !target.environments.every((e) => assignment.environments.includes(e))) return false;
  return true;
}

/**
 * `permission` is always 'access.grant' or 'access.revoke', fixed by the
 * calling route handler — NEVER read from the request body, which only ever
 * supplies role/scope. See accessAssignment.route.js.
 */
export async function canDelegate(actor, {
  permission, role, clientId, projectId, environments = [],
}) {
  if (!actor || actor.status !== 'active') return false;

  const scope = await resolveScope({ projectId, clientId });
  const assignments = await activeAssignmentsFor(actor._id);
  const containing = assignments.filter((a) => containsScope(a, { ...scope, environments }));
  const delegable = new Set(containing.flatMap((a) => ROLE_PERMISSIONS[a.role] || []));

  if (!delegable.has(permission)) return false;
  return (ROLE_PERMISSIONS[role] || []).every((p) => delegable.has(p));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/platform/__tests__/authorize.canDelegate.test.js backend/src/platform/__tests__/authorize.can.test.js`
Expected: PASS, all cases in both files.

- [ ] **Step 5: Commit**

```bash
git add backend/src/platform/authorize.js backend/src/platform/__tests__/authorize.canDelegate.test.js
git commit -m "feat(platform): add canDelegate() with scope and permission containment"
```

---

## Task 8: `requirePermission()` route middleware

**Files:**
- Modify: `backend/src/platform/auth.js`
- Create: `backend/src/platform/__tests__/auth.requirePermission.test.js`

**Interfaces:**
- Consumes: `can` (Task 6).
- Produces: `requirePermission(permission, scopeResolver?): (req, res, next) => Promise<void>` — `scopeResolver: (req) => Promise<{projectId?, clientId?, environment?}> | {projectId?, clientId?, environment?}`, defaults to `() => ({})` (global scope only). Consumed by Task 12 (Clients routes), Task 14 (AccessAssignment routes), Task 17 (users/teams/projects cutover), Task 18 (tickets delete cutover).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/platform/__tests__/auth.requirePermission.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from './helpers/memoryDb.js';
import User from '../../modules/users/user.model.js';
import AccessAssignment from '../../modules/access/accessAssignment.model.js';
import { requirePermission } from '../auth.js';

withMemoryDb();

function run(middleware, req) {
  return new Promise((resolve) => {
    middleware(req, {}, (err) => resolve(err));
  });
}

test('401 when req.user is missing', async () => {
  const err = await run(requirePermission('clients.manage'), {});
  assert.equal(err.statusCode, 401);
});

test('403 when the user lacks the permission', async () => {
  const user = await User.create({
    name: 'U', email: 'noperm@example.com', password: 'a-long-enough-password', status: 'active',
  });
  const err = await run(requirePermission('clients.manage'), { user });
  assert.equal(err.statusCode, 403);
  assert.equal(err.code, 'FORBIDDEN');
});

test('calls next() with no error when the user has the permission', async () => {
  const user = await User.create({
    name: 'U', email: 'hasperm@example.com', password: 'a-long-enough-password', status: 'active',
  });
  await AccessAssignment.create({ user: user._id, role: 'admin', grantedBy: user._id });
  const err = await run(requirePermission('clients.manage'), { user });
  assert.equal(err, undefined);
});

test('uses the scopeResolver result to scope the check', async () => {
  const user = await User.create({
    name: 'U', email: 'scoped@example.com', password: 'a-long-enough-password', status: 'active',
  });
  const clientId = new mongoose.Types.ObjectId();
  await AccessAssignment.create({ user: user._id, role: 'admin', client: clientId, grantedBy: user._id });

  const req = { user, params: { clientId: String(clientId) } };
  const scopeResolver = (r) => ({ clientId: r.params.clientId });

  const err = await run(requirePermission('clients.manage', scopeResolver), req);
  assert.equal(err, undefined);
});

test('propagates an error thrown by the scopeResolver as the next() error', async () => {
  const user = await User.create({
    name: 'U', email: 'scoperr@example.com', password: 'a-long-enough-password', status: 'active',
  });
  const scopeResolver = () => { throw new Error('boom'); };
  const err = await run(requirePermission('clients.manage', scopeResolver), { user });
  assert.equal(err.message, 'boom');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/platform/__tests__/auth.requirePermission.test.js`
Expected: FAIL — `requirePermission` is not exported yet.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/src/platform/auth.js` (after the existing `requireRole`, which stays untouched — it is retired call-site-by-call-site in later tasks, not deleted here):

```js
import { can } from './authorize.js';

// ... existing auth() and requireRole() unchanged above ...

/**
 * Layer 2 replacement for requireRole — scoped, permission-based. scopeResolver
 * reads clientId/projectId/environment from req.params/req.query, or, for
 * checks that need a loaded document, resolves after the service loads it
 * (same pattern as ticket.service.js's existing ownership checks — see that
 * module's cutover task instead of adding a document-loading resolver here).
 */
export function requirePermission(permission, scopeResolver = () => ({})) {
  return async function checkPermission(req, _res, next) {
    try {
      if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
      const scope = await scopeResolver(req);
      const allowed = await can(req.user, permission, scope);
      if (!allowed) {
        return next(new ApiError(403, 'FORBIDDEN', `Requires permission: ${permission}`));
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/platform/__tests__/auth.requirePermission.test.js`
Expected: PASS, all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/platform/auth.js backend/src/platform/__tests__/auth.requirePermission.test.js
git commit -m "feat(platform): add requirePermission() route middleware"
```

---

## Task 9: Client service, controller, route, validation

**Scope note — audit writes here are NOT transactional, unlike AccessAssignment (Task 11):** transactions in this codebase are deliberately scoped to the last-global-admin invariant (Task 5), where the guarantee is load-bearing for a security property. A Client rename/archive has no privilege-escalation risk from an untracked write, so this task uses plain sequential writes (mutate, then audit) rather than extending transaction usage further than justified. If the audit write fails after the client write succeeds, that's a real but low-severity gap — logged as an application error, not silently swallowed.

**Files:**
- Create: `backend/src/modules/clients/client.service.js`
- Create: `backend/src/modules/clients/client.controller.js`
- Create: `backend/src/modules/clients/client.route.js`
- Create: `backend/src/modules/clients/client.validation.js`
- Create: `backend/src/modules/clients/__tests__/client.service.test.js`

**Interfaces:**
- Consumes: `Client` (Task 2), `AuditLog` (Task 4), `effectiveScope`, `requirePermission` (Tasks 6, 8).
- Produces: `clientRoutes(config): express.Router`, mounted in Task 13. `createClient`, `listClients`, `getClient`, `updateClient` — service functions, same shape as `team.service.js`'s exports (`(actor, body, requestId?) => plain object`).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/clients/__tests__/client.service.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import AuditLog from '../../access/auditLog.model.js';
import Client from '../client.model.js';
import {
  createClient, listClients, getClient, updateClient,
} from '../client.service.js';

withMemoryDb();

const actor = () => ({ _id: new mongoose.Types.ObjectId() });

test('createClient writes the client and a CLIENT_CREATED audit entry', async () => {
  const who = actor();
  const client = await createClient(who, { name: 'Acme' }, 'req_1');

  assert.equal(client.name, 'Acme');
  const entries = await AuditLog.find({ targetId: client.id });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].action, 'CLIENT_CREATED');
  assert.equal(entries[0].requestId, 'req_1');
});

test('createClient rejects a name already used by an active client', async () => {
  const who = actor();
  await createClient(who, { name: 'Acme' });
  await assert.rejects(
    () => createClient(who, { name: 'Acme' }),
    (err) => err.statusCode === 400 && err.code === 'CLIENT_NAME_TAKEN',
  );
});

test('updateClient archiving writes CLIENT_ARCHIVED with before/after status', async () => {
  const who = actor();
  const client = await createClient(who, { name: 'Acme' });
  await updateClient(who, client.id, { status: 'archived' }, 'req_2');

  const entries = await AuditLog.find({ targetId: client.id, action: 'CLIENT_ARCHIVED' });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].before.status, 'active');
  assert.equal(entries[0].after.status, 'archived');
});

test('updateClient reactivating writes CLIENT_REACTIVATED', async () => {
  const who = actor();
  const client = await createClient(who, { name: 'Acme' });
  await updateClient(who, client.id, { status: 'archived' });
  await updateClient(who, client.id, { status: 'active' });

  const entries = await AuditLog.find({ targetId: client.id, action: 'CLIENT_REACTIVATED' });
  assert.equal(entries.length, 1);
});

test('updateClient renaming writes plain CLIENT_UPDATED', async () => {
  const who = actor();
  const client = await createClient(who, { name: 'Acme' });
  await updateClient(who, client.id, { name: 'Acme Corp' });

  const entries = await AuditLog.find({ targetId: client.id, action: 'CLIENT_UPDATED' });
  assert.equal(entries.length, 1);
});

test('getClient throws 404 for a missing client', async () => {
  await assert.rejects(
    () => getClient(new mongoose.Types.ObjectId()),
    (err) => err.statusCode === 404,
  );
});

test('listClients returns everything for a global-scope actor', async () => {
  const who = actor();
  await AccessAssignment.create({ user: who._id, role: 'admin', grantedBy: who._id });
  await createClient(who, { name: 'Acme' });
  await createClient(who, { name: 'Globex' });

  const page = await listClients(who, {});
  assert.equal(page.results.length, 2);
});

test('listClients scopes results for a client-restricted actor', async () => {
  const who = actor();
  const acme = await Client.create({ name: 'Acme', createdBy: who._id });
  await Client.create({ name: 'Globex', createdBy: who._id });
  await AccessAssignment.create({ user: who._id, role: 'member', client: acme._id, grantedBy: who._id });

  const page = await listClients(who, {});
  assert.deepEqual(page.results.map((c) => c.name), ['Acme']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/clients/__tests__/client.service.test.js`
Expected: FAIL — `client.service.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/modules/clients/client.service.js
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import { effectiveScope } from '../../platform/authorize.js';
import AuditLog from '../access/auditLog.model.js';
import Client from './client.model.js';

// Friendly pre-check (matches project.service.js's PROJECT_KEY_TAKEN pattern) —
// the partial unique index (Task 2) is the atomic backstop for the race this
// check alone cannot close.
async function assertNameAvailable(name, excludeId) {
  const filter = { name, status: 'active' };
  if (excludeId) filter._id = { $ne: excludeId };
  if (await Client.exists(filter)) {
    throw new ApiError(400, 'CLIENT_NAME_TAKEN', `A client named "${name}" already exists`);
  }
}

export async function createClient(actor, { name }, requestId) {
  await assertNameAvailable(name);
  const client = await Client.create({ name, createdBy: actor._id });

  await AuditLog.create({
    actor: actor._id, action: 'CLIENT_CREATED', targetType: 'Client', targetId: client._id,
    client: client._id, after: { name: client.name, status: client.status }, requestId,
  });
  return client.toJSON();
}

export async function listClients(actor, query = {}) {
  const scope = await effectiveScope(actor._id);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (!scope.allClients) filter._id = { $in: scope.clientIds };

  const page = await paginate(Client, filter, {
    page: query.page, limit: query.limit, sortBy: query.sortBy || 'name:asc',
  });
  return { ...page, results: page.results.map((c) => c.toJSON()) };
}

export async function getClient(id) {
  const client = await Client.findById(id);
  if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Client not found');
  return client.toJSON();
}

export async function updateClient(actor, id, body, requestId) {
  const client = await Client.findById(id);
  if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Client not found');

  const before = { name: client.name, status: client.status };

  if (body.name !== undefined && body.name !== client.name) {
    await assertNameAvailable(body.name, client._id);
    client.name = body.name;
  }

  let action = 'CLIENT_UPDATED';
  if (body.status !== undefined && body.status !== client.status) {
    action = body.status === 'archived' ? 'CLIENT_ARCHIVED' : 'CLIENT_REACTIVATED';
    client.status = body.status;
  }

  await client.save();
  await AuditLog.create({
    actor: actor._id, action, targetType: 'Client', targetId: client._id, client: client._id,
    before, after: { name: client.name, status: client.status }, requestId,
  });
  return client.toJSON();
}
```

```js
// backend/src/modules/clients/client.controller.js
import catchAsync from '../../platform/catchAsync.js';
import * as clientService from './client.service.js';

export const list = catchAsync(async (req, res) => {
  res.json(await clientService.listClients(req.user, req.query));
});

export const create = catchAsync(async (req, res) => {
  res.status(201).json(await clientService.createClient(req.user, req.body, req.id));
});

export const get = catchAsync(async (req, res) => {
  res.json(await clientService.getClient(req.params.id));
});

export const update = catchAsync(async (req, res) => {
  res.json(await clientService.updateClient(req.user, req.params.id, req.body, req.id));
});
```

```js
// backend/src/modules/clients/client.validation.js
import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

export const listClientsSchema = {
  query: Joi.object({
    status: Joi.string().valid('active', 'archived'),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().max(80),
  }),
};

export const createClientSchema = {
  body: Joi.object({ name: Joi.string().trim().min(1).max(120).required() }),
};

export const clientIdSchema = { params: Joi.object({ id: objectId.required() }) };

export const updateClientSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    name: Joi.string().trim().min(1).max(120),
    status: Joi.string().valid('active', 'archived'),
  }).min(1),
};
```

```js
// backend/src/modules/clients/client.route.js
import express from 'express';
import { auth, requirePermission } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import * as controller from './client.controller.js';
import {
  listClientsSchema, createClientSchema, clientIdSchema, updateClientSchema,
} from './client.validation.js';

export default function clientRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', validate(listClientsSchema), controller.list);
  router.post('/', validate(createClientSchema), requirePermission('clients.manage'), controller.create);
  router.get('/:id', validate(clientIdSchema), controller.get);
  router.patch('/:id', validate(updateClientSchema),
    requirePermission('clients.manage', (req) => ({ clientId: req.params.id })), controller.update);

  return router;
}
```

**Ordering rule for every route in this plan: `validate()` always runs before `requirePermission()`.** A scope resolver may call `Model.findById()` on a URL param or body field; if that param hasn't been shape-checked yet, an invalid id throws a raw Mongoose `CastError` (a 500) instead of the clean 400 `validate()` would have produced. This is a small, deliberate deviation from this codebase's existing `requireRole` routes (which run the role check before validation, harmless there since `requireRole` never touches params/body) — validating first is strictly safer once the check needs to load a document, so this plan applies it uniformly rather than mixing orders per route.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/modules/clients/__tests__/client.service.test.js`
Expected: PASS, all 8 cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/clients/
git commit -m "feat(clients): add Client service, controller, route, validation"
```

---

## Task 10: AccessAssignment service — grant, modify, revoke, list

**Scope note — this task DOES use transactions for every mutation, unlike Task 9's Client service.** Unlike a Client rename, an untracked or partially-applied access mutation is exactly the failure mode this whole subsystem exists to close (`SECURITY.md` gap #1: "no audit log of role changes or access grants — anyone with admin has silent, untracked reach"). Every grant/modify/revoke below wraps the `AccessAssignment` write, the global-admin-counter update (when applicable), and the `AuditLog` write in one `withTransaction` call.

**Files:**
- Create: `backend/src/modules/access/accessAssignment.service.js`
- Create: `backend/src/modules/access/__tests__/accessAssignment.service.test.js`

**Interfaces:**
- Consumes: `canDelegate`, `resolveScope`, `can` (Tasks 6-7), `withTransaction` (Task 5), `assertActiveUsers` (existing, `team.service.js`), `incrementGlobalAdminCount`/`decrementGlobalAdminCount`/`isActiveGlobalAdmin` (Task 5), `AccessAssignment` (Task 3), `AuditLog` (Task 4).
- Produces: `grantAccess(actor, body, requestId): Promise<AssignmentJSON>`, `modifyAccess(actor, id, body, requestId): Promise<AssignmentJSON>`, `revokeAccess(actor, id, {reason}, requestId): Promise<AssignmentJSON>`, `listAccessAssignments(actor, query): Promise<Page>` — consumed by Task 11 (routes).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/access/__tests__/accessAssignment.service.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryReplSetDb } from '../../../platform/__tests__/helpers/memoryReplSetDb.js';
import { withTransaction } from '../../../platform/transaction.js';
import User from '../../users/user.model.js';
import Client from '../../clients/client.model.js';
import AccessAssignment from '../accessAssignment.model.js';
import AuditLog from '../auditLog.model.js';
import GlobalAdminCounter from '../globalAdminGuard.model.js';
import { GLOBAL_ADMIN_COUNTER_ID, initGlobalAdminCount } from '../globalAdminGuard.js';
import {
  grantAccess, modifyAccess, revokeAccess, listAccessAssignments,
} from '../accessAssignment.service.js';

withMemoryReplSetDb();

const activeUser = (n = Math.random().toString(36).slice(2)) => User.create({
  name: n, email: `${n}@example.com`, password: 'a-long-enough-password', status: 'active',
});
const client = (name = 'Acme') => Client.create({ name, createdBy: new mongoose.Types.ObjectId() });

async function counterValue() {
  const doc = await GlobalAdminCounter.findById(GLOBAL_ADMIN_COUNTER_ID);
  return doc?.count ?? 0;
}

test('a global admin can grant a scoped role to another user, and it is audited', async () => {
  const admin = await activeUser('admin1');
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });
  const target = await activeUser('target1');
  const c = await client();

  const created = await grantAccess(admin, {
    user: target._id, role: 'qa', client: c._id, environments: ['Staging'],
  }, 'req_grant');

  assert.equal(created.role, 'qa');
  const audit = await AuditLog.findOne({ targetId: created.id });
  assert.equal(audit.action, 'ACCESS_GRANTED');
  assert.equal(audit.requestId, 'req_grant');
});

test('granting a global admin assignment increments the counter', async () => {
  const admin = await activeUser('admin2');
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });
  const before = await counterValue();

  const target = await activeUser('target2');
  await grantAccess(admin, { user: target._id, role: 'admin' });

  assert.equal(await counterValue(), before + 1);
});

test('grantAccess rejects a scope broader than the actor holds', async () => {
  const actor = await activeUser('scoped1');
  const c = await client();
  await AccessAssignment.create({ user: actor._id, role: 'admin', client: c._id, grantedBy: actor._id });
  const target = await activeUser('target3');

  await assert.rejects(
    () => grantAccess(actor, { user: target._id, role: 'member' }), // no client = global
    (err) => err.statusCode === 403,
  );
});

test('grantAccess requires a reason to grant Production access', async () => {
  const admin = await activeUser('admin7');
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });
  const target = await activeUser('target6');

  await assert.rejects(
    () => grantAccess(admin, { user: target._id, role: 'qa', environments: ['Production'] }),
    (err) => err.statusCode === 400 && err.code === 'REASON_REQUIRED',
  );

  const granted = await grantAccess(admin, {
    user: target._id, role: 'qa', environments: ['Production'], reason: 'launch support',
  });
  assert.deepEqual(granted.environments, ['Production']);
});

test('modifyAccess suspending writes ACCESS_SUSPENDED and requires a reason', async () => {
  const admin = await activeUser('admin3');
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });
  const target = await activeUser('target4');
  const granted = await grantAccess(admin, { user: target._id, role: 'qa' });

  await assert.rejects(
    () => modifyAccess(admin, granted.id, { status: 'suspended' }),
    (err) => err.statusCode === 400 && err.code === 'REASON_REQUIRED',
  );

  const modified = await modifyAccess(
    admin, granted.id, { status: 'suspended', reason: 'leave of absence' },
  );
  assert.equal(modified.status, 'suspended');
  const audit = await AuditLog.findOne({ targetId: granted.id, action: 'ACCESS_SUSPENDED' });
  assert.ok(audit);
});

test('modifyAccess cannot suspend the last global admin', async () => {
  const admin = await activeUser('admin4');
  const [assignment] = await AccessAssignment.create([
    { user: admin._id, role: 'admin', grantedBy: admin._id },
  ]);
  await withTransaction((session) => initGlobalAdminCount(1, session));

  await assert.rejects(
    () => modifyAccess(admin, assignment.id, { status: 'suspended', reason: 'test' }),
    (err) => err.statusCode === 409 && err.code === 'LAST_ADMIN_PROTECTED',
  );
});

test('revokeAccess requires a reason, decrements the counter for a global admin, and audits', async () => {
  const admin = await activeUser('admin5');
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });
  const target = await activeUser('target5');
  const granted = await grantAccess(admin, { user: target._id, role: 'admin' });
  const before = await counterValue();

  await assert.rejects(
    () => revokeAccess(admin, granted.id, {}),
    (err) => err.statusCode === 400 && err.code === 'REASON_REQUIRED',
  );

  const revoked = await revokeAccess(admin, granted.id, { reason: 'role changed' });
  assert.equal(revoked.status, 'revoked');
  assert.equal(await counterValue(), before - 1);
  const audit = await AuditLog.findOne({ targetId: granted.id, action: 'ACCESS_REVOKED' });
  assert.ok(audit);
});

test('listAccessAssignments: a user always sees their own assignments', async () => {
  const u = await activeUser('self1');
  await AccessAssignment.create({ user: u._id, role: 'member', grantedBy: u._id });
  const page = await listAccessAssignments(u, {});
  assert.equal(page.results.length, 1);
});

test('listAccessAssignments: viewing another user requires access.view', async () => {
  const noPerm = await activeUser('nop1');
  const other = await activeUser('other1');
  await AccessAssignment.create({ user: other._id, role: 'member', grantedBy: other._id });

  await assert.rejects(
    () => listAccessAssignments(noPerm, { userId: String(other._id) }),
    (err) => err.statusCode === 403,
  );

  const admin = await activeUser('admin6');
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });
  const page = await listAccessAssignments(admin, { userId: String(other._id) });
  assert.equal(page.results.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/access/__tests__/accessAssignment.service.test.js`
Expected: FAIL — `accessAssignment.service.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/modules/access/accessAssignment.service.js
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import { can, canDelegate, resolveScope } from '../../platform/authorize.js';
import { withTransaction } from '../../platform/transaction.js';
import { assertActiveUsers } from '../teams/team.service.js';
import {
  incrementGlobalAdminCount, decrementGlobalAdminCount, isActiveGlobalAdmin,
} from './globalAdminGuard.js';
import AccessAssignment from './accessAssignment.model.js';
import AuditLog from './auditLog.model.js';

function snapshot(a) {
  return {
    role: a.role, client: a.client, project: a.project,
    environments: a.environments, status: a.status, expiresAt: a.expiresAt,
  };
}

export async function grantAccess(actor, body, requestId) {
  const environments = body.environments || [];
  if (environments.includes('Production') && !body.reason) {
    throw new ApiError(400, 'REASON_REQUIRED', 'A reason is required to grant Production access');
  }

  await assertActiveUsers([body.user]);
  const scope = await resolveScope({ projectId: body.project, clientId: body.client });

  const allowed = await canDelegate(actor, {
    permission: 'access.grant', role: body.role,
    clientId: scope.clientId, projectId: scope.projectId, environments,
  });
  if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'You cannot grant that role at that scope');

  return withTransaction(async (session) => {
    const [assignment] = await AccessAssignment.create([{
      user: body.user, role: body.role, client: scope.clientId, project: scope.projectId,
      environments, expiresAt: body.expiresAt || null, grantedBy: actor._id, reason: body.reason,
    }], { session });

    if (isActiveGlobalAdmin(assignment)) await incrementGlobalAdminCount(session);

    await AuditLog.create([{
      actor: actor._id, action: 'ACCESS_GRANTED', targetType: 'AccessAssignment', targetId: assignment._id,
      client: scope.clientId, project: scope.projectId, before: null, after: snapshot(assignment),
      reason: body.reason, requestId,
    }], { session });

    return assignment.toJSON();
  });
}

export async function modifyAccess(actor, id, body, requestId) {
  return withTransaction(async (session) => {
    const assignment = await AccessAssignment.findById(id).session(session);
    if (!assignment) throw new ApiError(404, 'ACCESS_ASSIGNMENT_NOT_FOUND', 'Access assignment not found');

    const nextRole = body.role ?? assignment.role;
    const nextEnvironments = body.environments ?? assignment.environments;

    const allowed = await canDelegate(actor, {
      permission: 'access.grant', role: nextRole,
      clientId: assignment.client, projectId: assignment.project, environments: nextEnvironments,
    });
    if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'You cannot modify this assignment to that role/scope');

    const wasGlobalAdmin = isActiveGlobalAdmin(assignment);
    const before = snapshot(assignment);
    const wasActive = assignment.status === 'active';

    if (body.status === 'suspended' && !body.reason) {
      throw new ApiError(400, 'REASON_REQUIRED', 'A reason is required to suspend access');
    }
    if (body.environments?.includes('Production') && !(body.reason ?? assignment.reason)) {
      throw new ApiError(400, 'REASON_REQUIRED', 'A reason is required to grant Production access');
    }

    if (body.role !== undefined) assignment.role = body.role;
    if (body.environments !== undefined) assignment.environments = body.environments;
    if (body.expiresAt !== undefined) assignment.expiresAt = body.expiresAt;
    if (body.reason !== undefined) assignment.reason = body.reason;
    if (body.status !== undefined) assignment.status = body.status;

    const willBeGlobalAdmin = isActiveGlobalAdmin(assignment);
    if (wasGlobalAdmin && !willBeGlobalAdmin) await decrementGlobalAdminCount(session);
    if (!wasGlobalAdmin && willBeGlobalAdmin) await incrementGlobalAdminCount(session);

    await assignment.save({ session });

    const action = assignment.status === 'suspended' ? 'ACCESS_SUSPENDED'
      : assignment.status === 'active' && !wasActive ? 'ACCESS_REACTIVATED'
        : 'ACCESS_MODIFIED';

    await AuditLog.create([{
      actor: actor._id, action, targetType: 'AccessAssignment', targetId: assignment._id,
      client: assignment.client, project: assignment.project, before, after: snapshot(assignment),
      reason: body.reason, requestId,
    }], { session });

    return assignment.toJSON();
  });
}

export async function revokeAccess(actor, id, { reason } = {}, requestId) {
  if (!reason) throw new ApiError(400, 'REASON_REQUIRED', 'A reason is required to revoke access');

  return withTransaction(async (session) => {
    const assignment = await AccessAssignment.findById(id).session(session);
    if (!assignment) throw new ApiError(404, 'ACCESS_ASSIGNMENT_NOT_FOUND', 'Access assignment not found');

    const allowed = await canDelegate(actor, {
      permission: 'access.revoke', role: assignment.role,
      clientId: assignment.client, projectId: assignment.project, environments: assignment.environments,
    });
    if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'You cannot revoke this assignment');

    const wasGlobalAdmin = isActiveGlobalAdmin(assignment);
    const before = snapshot(assignment);

    assignment.status = 'revoked';
    assignment.reason = reason;
    if (wasGlobalAdmin) await decrementGlobalAdminCount(session);
    await assignment.save({ session });

    await AuditLog.create([{
      actor: actor._id, action: 'ACCESS_REVOKED', targetType: 'AccessAssignment', targetId: assignment._id,
      client: assignment.client, project: assignment.project, before, after: snapshot(assignment),
      reason, requestId,
    }], { session });

    return assignment.toJSON();
  });
}

export async function listAccessAssignments(actor, query = {}) {
  const targetUserId = query.userId || String(actor._id);
  const isSelf = targetUserId === String(actor._id);

  if (!isSelf && !(await can(actor, 'access.view', {}))) {
    throw new ApiError(403, 'FORBIDDEN', "You cannot view another user's access");
  }

  const page = await paginate(AccessAssignment, { user: targetUserId }, {
    page: query.page, limit: query.limit, sortBy: query.sortBy || 'createdAt:desc',
    populate: ['client', 'project'],
  });
  return { ...page, results: page.results.map((a) => a.toJSON()) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/modules/access/__tests__/accessAssignment.service.test.js`
Expected: PASS, all 9 cases. This is the slowest test file in the plan (`MongoMemoryReplSet` startup) — allow it extra time on first run.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/access/accessAssignment.service.js backend/src/modules/access/__tests__/accessAssignment.service.test.js
git commit -m "feat(access): add AccessAssignment grant/modify/revoke/list service"
```

---

## Task 11: AccessAssignment route, validation, rate limiting

**Deliberate omission worth flagging to a reviewer:** the mutation routes below do NOT also wrap themselves in `requirePermission(...)`. That would run the coarse, scope-free `can()` check as a route gate on top of the fine-grained, scope-and-role-aware `canDelegate()` check the service functions already run — redundant at best, and a chance for the two checks to disagree at worst. Authorization for grant/modify/revoke is `canDelegate()`, evaluated inside the service, full stop.

**Files:**
- Create: `backend/src/modules/access/accessAssignment.validation.js`
- Create: `backend/src/modules/access/accessAssignment.controller.js`
- Create: `backend/src/modules/access/accessAssignment.route.js`
- Modify: `backend/src/platform/rateLimit.js`
- Create: `backend/src/modules/access/__tests__/accessAssignment.routes.test.js`

**Interfaces:**
- Consumes: `grantAccess`/`modifyAccess`/`revokeAccess`/`listAccessAssignments` (Task 10).
- Produces: `accessAssignmentRoutes(config): express.Router` — mounted in Task 13. `accessMutationLimiter` (new export from `rateLimit.js`).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/access/__tests__/accessAssignment.routes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { withMemoryReplSetDb } from '../../../platform/__tests__/helpers/memoryReplSetDb.js';
import User from '../../users/user.model.js';
import Client from '../../clients/client.model.js';
import AccessAssignment from '../accessAssignment.model.js';
import { createApp } from '../../../app.js';
import { generateAccessToken } from '../../auth/token.service.js';

withMemoryReplSetDb();

const config = {
  nodeEnv: 'test', isProduction: false, port: 4000, mongoUrl: 'mongodb://unused',
  frontendBaseUrl: 'http://localhost:3000', corsOrigins: ['http://localhost:3000'],
  jwt: { secret: 'a-sufficiently-long-test-secret-value-here', accessExpirationMinutes: 15, refreshExpirationDays: 30 },
  cookie: { domain: undefined, secure: false },
  features: { attachments: false, email: false, seed: false },
  storage: null, email: null, seed: null,
};

const app = () => createApp(config);
const bearer = (user) => `Bearer ${generateAccessToken(user, config)}`;

const activeUser = (n) => User.create({
  name: n, email: `${n}@example.com`, password: 'a-long-enough-password', status: 'active',
});

test('POST /v1/access-assignments is 401 unauthenticated', async () => {
  await request(app()).post('/v1/access-assignments').send({ user: 'x', role: 'member' }).expect(401);
});

test('a global admin grants scoped qa access over HTTP, and it is auditable', async () => {
  const admin = await activeUser('admin');
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });
  const target = await activeUser('target');
  const client = await Client.create({ name: 'Acme', createdBy: admin._id });

  const res = await request(app())
    .post('/v1/access-assignments')
    .set('Authorization', bearer(admin))
    .send({ user: String(target._id), role: 'qa', client: String(client._id), environments: ['Staging'] })
    .expect(201);

  assert.equal(res.body.role, 'qa');
  assert.equal(res.body.client, String(client._id));
});

test('a client-A-scoped actor is rejected granting access on client B — cross-client isolation', async () => {
  const actor = await activeUser('scoped');
  const clientA = await Client.create({ name: 'Acme', createdBy: actor._id });
  const clientB = await Client.create({ name: 'Globex', createdBy: actor._id });
  await AccessAssignment.create({ user: actor._id, role: 'admin', client: clientA._id, grantedBy: actor._id });
  const target = await activeUser('target2');

  await request(app())
    .post('/v1/access-assignments')
    .set('Authorization', bearer(actor))
    .send({ user: String(target._id), role: 'member', client: String(clientB._id) })
    .expect(403);
});

test('a validation error rejects an unrecognized role before it reaches the service', async () => {
  const admin = await activeUser('admin2');
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });

  const res = await request(app())
    .post('/v1/access-assignments')
    .set('Authorization', bearer(admin))
    .send({ user: String(new mongoose.Types.ObjectId()), role: 'superadmin' })
    .expect(400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('DELETE requires a reason in the body', async () => {
  const admin = await activeUser('admin3');
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });
  const target = await activeUser('target3');
  const created = await request(app())
    .post('/v1/access-assignments')
    .set('Authorization', bearer(admin))
    .send({ user: String(target._id), role: 'member' })
    .expect(201);

  await request(app())
    .delete(`/v1/access-assignments/${created.body.id}`)
    .set('Authorization', bearer(admin))
    .send({})
    .expect(400);

  await request(app())
    .delete(`/v1/access-assignments/${created.body.id}`)
    .set('Authorization', bearer(admin))
    .send({ reason: 'no longer needed' })
    .expect(200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/access/__tests__/accessAssignment.routes.test.js`
Expected: FAIL — route not mounted yet (Task 13), files don't exist.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/modules/access/accessAssignment.validation.js
import Joi from 'joi';
import { ROLES, ENVIRONMENTS } from '@pms/shared';

const objectId = Joi.string().hex().length(24);

export const listAccessAssignmentsSchema = {
  query: Joi.object({
    userId: objectId,
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().max(80),
  }),
};

export const grantAccessSchema = {
  body: Joi.object({
    user: objectId.required(),
    role: Joi.string().valid(...ROLES).required(),
    client: objectId.allow(null),
    project: objectId.allow(null),
    environments: Joi.array().items(Joi.string().valid(...ENVIRONMENTS)).default([]),
    expiresAt: Joi.date().greater('now').allow(null),
    reason: Joi.string().trim().max(500).allow(''),
  }),
};

export const accessAssignmentIdSchema = { params: Joi.object({ id: objectId.required() }) };

export const modifyAccessSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    role: Joi.string().valid(...ROLES),
    environments: Joi.array().items(Joi.string().valid(...ENVIRONMENTS)),
    status: Joi.string().valid('active', 'suspended'),
    expiresAt: Joi.date().greater('now').allow(null),
    reason: Joi.string().trim().max(500),
  }).min(1),
};

export const revokeAccessSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({ reason: Joi.string().trim().min(1).max(500).required() }),
};
```

```js
// backend/src/modules/access/accessAssignment.controller.js
import catchAsync from '../../platform/catchAsync.js';
import * as service from './accessAssignment.service.js';

export const list = catchAsync(async (req, res) => {
  res.json(await service.listAccessAssignments(req.user, req.query));
});

export const grant = catchAsync(async (req, res) => {
  res.status(201).json(await service.grantAccess(req.user, req.body, req.id));
});

export const modify = catchAsync(async (req, res) => {
  res.json(await service.modifyAccess(req.user, req.params.id, req.body, req.id));
});

export const revoke = catchAsync(async (req, res) => {
  res.json(await service.revokeAccess(req.user, req.params.id, req.body, req.id));
});
```

```js
// backend/src/modules/access/accessAssignment.route.js
import express from 'express';
import { auth } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import { accessMutationLimiter } from '../../platform/rateLimit.js';
import * as controller from './accessAssignment.controller.js';
import {
  listAccessAssignmentsSchema, grantAccessSchema, accessAssignmentIdSchema,
  modifyAccessSchema, revokeAccessSchema,
} from './accessAssignment.validation.js';

export default function accessAssignmentRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', validate(listAccessAssignmentsSchema), controller.list);
  router.post('/', accessMutationLimiter, validate(grantAccessSchema), controller.grant);
  router.patch('/:id', accessMutationLimiter, validate(modifyAccessSchema), controller.modify);
  router.delete('/:id', accessMutationLimiter, validate(revokeAccessSchema), controller.revoke);

  return router;
}
```

Modify `backend/src/platform/rateLimit.js` — add a `byActor` key option (backward compatible: existing calls omit it and default to false) and one new limiter:

```js
export function makeLimiter({ windowMs, limit, byEmail = false, byActor = false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    validate: false,
    keyGenerator: (req) => {
      const ip = req.ip || 'unknown-ip';
      // Authenticated mutation routes: key by actor, not IP — several admins
      // can share an office network, and IP-keying would cross-throttle them.
      if (byActor) return req.user ? String(req.user._id) : ip;
      if (!byEmail) return ip;
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      return email || ip;
    },
    handler: (_req, _res, next) => next(
      new ApiError(429, 'RATE_LIMITED', 'Too many requests, please try again later'),
    ),
  });
}

const MINUTE = 60 * 1000;

export const loginLimiter = makeLimiter({ windowMs: 15 * MINUTE, limit: 10, byEmail: true });
export const passwordResetLimiter = makeLimiter({ windowMs: 60 * MINUTE, limit: 5, byEmail: true });
export const inviteAcceptLimiter = makeLimiter({ windowMs: 60 * MINUTE, limit: 10 });
export const refreshLimiter = makeLimiter({ windowMs: 15 * MINUTE, limit: 60 });
export const resendInviteLimiter = makeLimiter({ windowMs: 60 * MINUTE, limit: 10 });
// A privilege-escalation control plane if an admin session is compromised —
// capped independently of the general per-IP traffic the app otherwise allows.
export const accessMutationLimiter = makeLimiter({ windowMs: 15 * MINUTE, limit: 30, byActor: true });
```

- [ ] **Step 4: Run test to verify it passes**

This test file depends on Task 13 (routes mounted in `app.js`) to pass end-to-end — run it again after Task 13 and confirm all 5 cases pass then. For now:

Run: `node --test backend/src/modules/access/__tests__/accessAssignment.routes.test.js`
Expected: still FAIL (404s) until Task 13 mounts the route — commit this task anyway, the route/validation/controller code is correct and unit-testable in isolation; Task 13 is the wiring step.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/access/accessAssignment.validation.js backend/src/modules/access/accessAssignment.controller.js backend/src/modules/access/accessAssignment.route.js backend/src/platform/rateLimit.js backend/src/modules/access/__tests__/accessAssignment.routes.test.js
git commit -m "feat(access): add AccessAssignment routes, validation, and rate limiting"
```

---

## Task 12: AuditLog service, controller, route, validation

**Files:**
- Create: `backend/src/modules/access/auditLog.service.js`
- Create: `backend/src/modules/access/auditLog.controller.js`
- Create: `backend/src/modules/access/auditLog.route.js`
- Create: `backend/src/modules/access/auditLog.validation.js`
- Create: `backend/src/modules/access/__tests__/auditLog.service.test.js`

**Interfaces:**
- Consumes: `can` (Task 6), `AuditLog`/`AUDIT_ACTIONS` (Task 4).
- Produces: `auditLogRoutes(config): express.Router` — mounted in Task 13.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/access/__tests__/auditLog.service.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import AccessAssignment from '../accessAssignment.model.js';
import AuditLog from '../auditLog.model.js';
import { listAuditLog } from '../auditLog.service.js';

withMemoryDb();

const id = () => new mongoose.Types.ObjectId();
const activeUser = () => ({ _id: id(), status: 'active' });

test('a global admin can list the audit log', async () => {
  const admin = activeUser();
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });
  await AuditLog.create({
    actor: admin._id, action: 'CLIENT_CREATED', targetType: 'Client', targetId: id(),
  });

  const page = await listAuditLog(admin, {});
  assert.equal(page.results.length, 1);
});

test('a user without audit.view is rejected', async () => {
  const member = activeUser();
  await AccessAssignment.create({ user: member._id, role: 'member', grantedBy: member._id });
  await assert.rejects(() => listAuditLog(member, {}), (err) => err.statusCode === 403);
});

test('an admin scoped to one client sees only that client\'s entries', async () => {
  const scopedAdmin = activeUser();
  const c1 = id();
  const c2 = id();
  await AccessAssignment.create({
    user: scopedAdmin._id, role: 'admin', client: c1, grantedBy: scopedAdmin._id,
  });
  await AuditLog.create({
    actor: scopedAdmin._id, action: 'CLIENT_CREATED', targetType: 'Client', targetId: c1, client: c1,
  });
  await AuditLog.create({
    actor: scopedAdmin._id, action: 'CLIENT_CREATED', targetType: 'Client', targetId: c2, client: c2,
  });

  const page = await listAuditLog(scopedAdmin, { client: String(c1) });
  assert.equal(page.results.length, 1);

  await assert.rejects(
    () => listAuditLog(scopedAdmin, { client: String(c2) }),
    (err) => err.statusCode === 403,
  );
});

test('filters by action', async () => {
  const admin = activeUser();
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });
  await AuditLog.create({ actor: admin._id, action: 'CLIENT_CREATED', targetType: 'Client', targetId: id() });
  await AuditLog.create({
    actor: admin._id, action: 'ACCESS_GRANTED', targetType: 'AccessAssignment', targetId: id(),
  });

  const page = await listAuditLog(admin, { action: 'CLIENT_CREATED' });
  assert.equal(page.results.length, 1);
  assert.equal(page.results[0].action, 'CLIENT_CREATED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/access/__tests__/auditLog.service.test.js`
Expected: FAIL — `auditLog.service.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/modules/access/auditLog.service.js
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import { can } from '../../platform/authorize.js';
import AuditLog from './auditLog.model.js';

export async function listAuditLog(actor, query = {}) {
  const allowed = await can(actor, 'audit.view', { clientId: query.client });
  if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'You cannot view the audit log');

  const filter = {};
  if (query.actor) filter.actor = query.actor;
  if (query.action) filter.action = query.action;
  if (query.client) filter.client = query.client;
  if (query.project) filter.project = query.project;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }

  const page = await paginate(AuditLog, filter, {
    page: query.page, limit: query.limit, sortBy: query.sortBy || 'createdAt:desc',
    populate: ['actor', 'client', 'project'],
  });
  return { ...page, results: page.results.map((e) => e.toJSON()) };
}
```

```js
// backend/src/modules/access/auditLog.controller.js
import catchAsync from '../../platform/catchAsync.js';
import * as service from './auditLog.service.js';

export const list = catchAsync(async (req, res) => {
  res.json(await service.listAuditLog(req.user, req.query));
});
```

```js
// backend/src/modules/access/auditLog.validation.js
import Joi from 'joi';
import { AUDIT_ACTIONS } from './auditLog.model.js';

const objectId = Joi.string().hex().length(24);

export const listAuditLogSchema = {
  query: Joi.object({
    actor: objectId,
    client: objectId,
    project: objectId,
    action: Joi.string().valid(...AUDIT_ACTIONS),
    from: Joi.date().iso(),
    to: Joi.date().iso(),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().max(80),
  }),
};
```

```js
// backend/src/modules/access/auditLog.route.js
import express from 'express';
import { auth } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import * as controller from './auditLog.controller.js';
import { listAuditLogSchema } from './auditLog.validation.js';

export default function auditLogRoutes(config) {
  const router = express.Router();
  router.use(auth(config));
  router.get('/', validate(listAuditLogSchema), controller.list);
  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/modules/access/__tests__/auditLog.service.test.js`
Expected: PASS, all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/access/auditLog.service.js backend/src/modules/access/auditLog.controller.js backend/src/modules/access/auditLog.route.js backend/src/modules/access/auditLog.validation.js backend/src/modules/access/__tests__/auditLog.service.test.js
git commit -m "feat(access): add audit-log query service, route, and validation"
```

---

## Task 13: Mount the new routes; wire the last-admin guard into user.service.js

**Why user.service.js needs a guard too, and why it does NOT use a transaction:** `can()` checks `user.status !== 'active'` directly — deactivating a `User` (via the existing `PATCH /v1/users/:id` or `DELETE /v1/users/:id`) disables every one of their `AccessAssignment`s without touching those documents at all. If that user held the sole global admin assignment, deactivating them must be blocked the same way revoking their assignment would be — otherwise the whole guarantee has a hole exactly where an attacker (or a careless admin) would find it. But `GlobalAdminCounter.findOneAndUpdate(...)` is *already* atomic as a single-document operation, with or without a session — the multi-document `withTransaction` wrapper (Task 10) exists to keep the `AccessAssignment` write and its `AuditLog` entry atomic together, which doesn't apply here. Wrapping this in a transaction would also force `backend/src/modules/users/__tests__/` onto the replica-set test helper, which would slow down and complicate every *existing* user test, not just the new ones. So this task calls the counter functions directly, without a session — narrower guarantee than Task 10's (a User-write failure after the counter already moved is a real but rare inconsistency window), explicitly accepted and documented here rather than silently different.

**Files:**
- Modify: `backend/src/app.js`
- Modify: `backend/src/modules/users/user.service.js`
- Create: `backend/src/modules/users/__tests__/user.service.lastAdmin.test.js`

**Interfaces:**
- Consumes: `clientRoutes` (Task 9), `accessAssignmentRoutes` (Task 11), `auditLogRoutes` (Task 12), `hasActiveGlobalAdminAssignment`/`incrementGlobalAdminCount`/`decrementGlobalAdminCount` (Task 5), `AuditLog` (Task 4).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/users/__tests__/user.service.lastAdmin.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../user.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import AuditLog from '../../access/auditLog.model.js';
import GlobalAdminCounter from '../../access/globalAdminGuard.model.js';
import { GLOBAL_ADMIN_COUNTER_ID } from '../../access/globalAdminGuard.js';
import { updateUser, deleteUser } from '../user.service.js';

withMemoryDb();

async function admin() {
  const user = await User.create({
    name: 'Admin', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', role: 'admin', status: 'active',
  });
  await AccessAssignment.create({ user: user._id, role: 'admin', grantedBy: user._id });
  await GlobalAdminCounter.findOneAndUpdate(
    { _id: GLOBAL_ADMIN_COUNTER_ID }, { $inc: { count: 1 } }, { upsert: true },
  );
  return user;
}

test('deactivating the sole global admin via updateUser is blocked', async () => {
  const target = await admin(); // exactly one global admin, counter = 1
  const actor = { _id: new mongoose.Types.ObjectId() };

  await assert.rejects(
    () => updateUser(actor, target._id, { status: 'inactive' }),
    (err) => err.statusCode === 409 && err.code === 'LAST_ADMIN_PROTECTED',
  );
});

test('deactivating one of two global admins succeeds and writes USER_SUSPENDED', async () => {
  const actor = await admin();
  const target = await admin();

  const updated = await updateUser(actor, target._id, { status: 'inactive' });
  assert.equal(updated.status, 'inactive');

  const entry = await AuditLog.findOne({ targetId: target._id, action: 'USER_SUSPENDED' });
  assert.ok(entry);
});

test('reactivating a deactivated global admin restores the counter and audits USER_REACTIVATED', async () => {
  const actor = await admin();
  const target = await admin();
  await updateUser(actor, target._id, { status: 'inactive' });
  const before = (await GlobalAdminCounter.findById(GLOBAL_ADMIN_COUNTER_ID)).count;

  await updateUser(actor, target._id, { status: 'active' });

  const after = (await GlobalAdminCounter.findById(GLOBAL_ADMIN_COUNTER_ID)).count;
  assert.equal(after, before + 1);
  assert.ok(await AuditLog.findOne({ targetId: target._id, action: 'USER_REACTIVATED' }));
});

test('a non-status update does not touch the counter or write an audit entry', async () => {
  const actor = await admin();
  const target = await admin();
  const before = (await GlobalAdminCounter.findById(GLOBAL_ADMIN_COUNTER_ID)).count;

  await updateUser(actor, target._id, { name: 'Renamed' });

  assert.equal((await GlobalAdminCounter.findById(GLOBAL_ADMIN_COUNTER_ID)).count, before);
  assert.equal(await AuditLog.countDocuments({ targetId: target._id }), 0);
});

test('deleteUser on the sole scoped global admin is blocked, even when a different User document merely carries the legacy role field', async () => {
  const target = await admin(); // sole global-scope AccessAssignment admin, counter = 1
  // A second User with the legacy flat role='admin' but NO AccessAssignment —
  // satisfies deleteUser's pre-existing User.role-based check, so this test
  // exercises the NEW scoped guard specifically, not the old one.
  await User.create({
    name: 'Legacy', email: `${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-long-enough-password', role: 'admin', status: 'active',
  });
  const actor = { _id: new mongoose.Types.ObjectId() };

  await assert.rejects(
    () => deleteUser(actor, target._id),
    (err) => err.statusCode === 409 && err.code === 'LAST_ADMIN_PROTECTED',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/users/__tests__/user.service.lastAdmin.test.js`
Expected: FAIL — `updateUser`/`deleteUser` don't check the counter yet, `GlobalAdminCounter` never changes, no audit entries.

- [ ] **Step 3: Write minimal implementation**

Modify `backend/src/modules/users/user.service.js` — add imports and replace `updateUser`/`deleteUser`:

```js
import { NOTIFICATION_EVENTS } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import Notification from '../notifications/notification.model.js';
import Team from '../teams/team.model.js';
import Ticket from '../tickets/ticket.model.js';
import AuditLog from '../access/auditLog.model.js';
import {
  hasActiveGlobalAdminAssignment, incrementGlobalAdminCount, decrementGlobalAdminCount,
} from '../access/globalAdminGuard.js';
import User from './user.model.js';

// ... listUsers, getUser unchanged ...

export async function updateUser(actor, id, body) {
  if (String(actor._id) === String(id) && (body.role || body.status)) {
    throw new ApiError(400, 'CANNOT_MODIFY_SELF', 'You cannot change your own role or status');
  }

  if (body.status === undefined) {
    const user = await User.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    return user.toJSON();
  }

  const before = await User.findById(id);
  if (!before) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');

  const deactivating = body.status !== 'active' && before.status === 'active';
  const activating = body.status === 'active' && before.status !== 'active';

  // Single-document atomic counter update, deliberately NOT transactional
  // with the User write below — see this task's note.
  if (deactivating && await hasActiveGlobalAdminAssignment(id)) {
    await decrementGlobalAdminCount();
  }
  if (activating && await hasActiveGlobalAdminAssignment(id)) {
    await incrementGlobalAdminCount();
  }

  const user = await User.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');

  if (deactivating || activating) {
    await AuditLog.create({
      actor: actor._id, action: deactivating ? 'USER_SUSPENDED' : 'USER_REACTIVATED',
      targetType: 'User', targetId: user._id,
      before: { status: before.status }, after: { status: user.status },
    });
  }

  return user.toJSON();
}

// ... updateMe, updateNotificationPrefs unchanged ...

export async function deleteUser(actor, id) {
  if (String(actor._id) === String(id)) {
    throw new ApiError(400, 'CANNOT_DELETE_SELF', 'You cannot delete your own account');
  }

  const user = await User.findById(id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');

  // Legacy flat-role guard, left in place — harmless, and role no longer
  // drives authorization post-cutover, but there is no reason to remove it.
  if (user.role === 'admin') {
    const otherAdmins = await User.countDocuments({ role: 'admin', _id: { $ne: user._id } });
    if (otherAdmins === 0) {
      throw new ApiError(400, 'LAST_ADMIN', 'Cannot delete the last admin');
    }
  }

  const priorStatus = user.status;
  if (await hasActiveGlobalAdminAssignment(user._id)) {
    await decrementGlobalAdminCount();
  }

  await Promise.all([
    Notification.deleteMany({ user: user._id }),
    Team.updateMany({ members: user._id }, { $pull: { members: user._id } }),
    Team.updateMany({ lead: user._id }, { $unset: { lead: 1 } }),
    Ticket.updateMany({ assignedTo: user._id }, { $set: { assignedTo: null } }),
    Ticket.updateMany({ testedBy: user._id }, { $set: { testedBy: null } }),
    Ticket.updateMany({ watchers: user._id }, { $pull: { watchers: user._id } }),
    Ticket.updateMany(
      { blockedBy: user._id },
      { $set: { blocked: false }, $unset: { blockedBy: 1, blockedAt: 1, blockerReason: 1 } },
    ),
  ]);

  user.name = 'Deleted User';
  user.email = `deleted+${user._id}@internal`;
  user.status = 'inactive';
  user.inviteTokenHash = undefined;
  user.inviteTokenExpiresAt = undefined;
  user.refreshTokens = [];
  user.password = 'revoked-deleted-user-password';
  await user.save();

  if (priorStatus === 'active') {
    await AuditLog.create({
      actor: actor._id, action: 'USER_SUSPENDED', targetType: 'User', targetId: user._id,
      before: { status: priorStatus }, after: { status: 'inactive' }, reason: 'Account deleted',
    });
  }

  return { status: 'deleted' };
}
```

Modify `backend/src/app.js` — add three imports and three mounts:

```js
import authRoutes from './modules/auth/auth.route.js';
import teamRoutes from './modules/teams/team.route.js';
import projectRoutes from './modules/projects/project.route.js';
import ticketRoutes from './modules/tickets/ticket.route.js';
import userRoutes from './modules/users/user.route.js';
import notificationRoutes from './modules/notifications/notification.route.js';
import analyticsRoutes from './modules/tickets/analytics.route.js';
import clientRoutes from './modules/clients/client.route.js';
import accessAssignmentRoutes from './modules/access/accessAssignment.route.js';
import auditLogRoutes from './modules/access/auditLog.route.js';

// ... inside createApp(), alongside the other app.use('/v1/...') calls ...
  app.use('/v1/auth', authRoutes(config, deliverReset));
  app.use('/v1/teams', teamRoutes(config));
  app.use('/v1/projects', projectRoutes(config));
  app.use('/v1/tickets', ticketRoutes(config));
  app.use('/v1/users', userRoutes(config, deliverInvite));
  app.use('/v1/notifications', notificationRoutes(config));
  app.use('/v1/analytics', analyticsRoutes(config));
  app.use('/v1/clients', clientRoutes(config));
  app.use('/v1/access-assignments', accessAssignmentRoutes(config));
  app.use('/v1/audit-log', auditLogRoutes(config));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/modules/users/__tests__/user.service.lastAdmin.test.js`
Expected: PASS, all 5 cases. Then run the full existing user suite to confirm nothing regressed: `node --test backend/src/modules/users/__tests__/*.test.js`. Then re-run Task 11's route test, which needed this task's app.js wiring: `node --test backend/src/modules/access/__tests__/accessAssignment.routes.test.js` — expect PASS now.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app.js backend/src/modules/users/user.service.js backend/src/modules/users/__tests__/user.service.lastAdmin.test.js
git commit -m "feat(access): mount clients/access-assignments/audit-log routes; guard user deactivation against removing the last global admin"
```

---

## Task 14: Migration script — dry-run and apply

**Files:**
- Create: `backend/src/modules/access/migration.js`
- Create: `backend/scripts/migrate-phase1-access-control.js`
- Create: `backend/src/modules/access/__tests__/migration.test.js`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `Client` (Task 2), `AccessAssignment`/`AuditLog` (Tasks 3-4), `initGlobalAdminCount` (Task 5).
- Produces: `runMigration({ apply?: boolean }): Promise<report>` — the CLI script (Step 3, second file) is a thin wrapper with no logic of its own, so this task's tests exercise `runMigration` directly rather than shelling out.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/access/__tests__/migration.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Client from '../../clients/client.model.js';
import AccessAssignment from '../accessAssignment.model.js';
import AuditLog from '../auditLog.model.js';
import GlobalAdminCounter from '../globalAdminGuard.model.js';
import { GLOBAL_ADMIN_COUNTER_ID } from '../globalAdminGuard.js';
import { runMigration } from '../migration.js';

withMemoryDb();

async function seed() {
  const admin = await User.create({
    name: 'Admin', email: 'admin@example.com', password: 'a-long-enough-password',
    role: 'admin', status: 'active',
  });
  const dev = await User.create({
    name: 'Dev', email: 'dev@example.com', password: 'a-long-enough-password',
    role: 'developer', status: 'active',
  });
  await Project.create({ key: 'WEB', brand: 'Dharwin', name: 'Web App', createdBy: admin._id });
  await Project.create({ key: 'MOB', brand: 'Dharwin', name: 'Mobile App', createdBy: admin._id });
  await Project.create({ key: 'ERP', brand: 'Globex', name: 'ERP', createdBy: admin._id });
  return { admin, dev };
}

test('dry run reports the plan without writing anything', async () => {
  await seed();
  const report = await runMigration({ apply: false });

  assert.deepEqual([...report.clientsToCreate].sort(), ['Dharwin', 'Globex']);
  assert.equal(report.usersToMigrate, 2);
  assert.deepEqual(report.byRole, { admin: 1, developer: 1 });
  assert.equal(await Client.countDocuments(), 0);
  assert.equal(await AccessAssignment.countDocuments(), 0);
});

test('apply creates one Client per distinct brand and links its projects', async () => {
  await seed();
  await runMigration({ apply: true });

  const clients = await Client.find({});
  assert.equal(clients.length, 2);
  const dharwin = clients.find((c) => c.name === 'Dharwin');
  assert.equal(await Project.countDocuments({ client: dharwin._id }), 2);
});

test('apply creates one global AccessAssignment per user with full environment access, and audits it', async () => {
  const { dev } = await seed();
  await runMigration({ apply: true });

  const assignment = await AccessAssignment.findOne({ user: dev._id });
  assert.equal(assignment.role, 'developer');
  assert.equal(assignment.client, null);
  assert.deepEqual([...assignment.environments].sort(), ['Development', 'Production', 'Staging']);

  const audit = await AuditLog.findOne({ targetId: assignment._id, action: 'ACCESS_GRANTED' });
  assert.ok(audit);
});

test('apply initializes the global admin counter to the real admin count', async () => {
  await seed();
  await runMigration({ apply: true });

  const counter = await GlobalAdminCounter.findById(GLOBAL_ADMIN_COUNTER_ID);
  assert.equal(counter.count, 1);
});

test('running apply twice does not duplicate clients or assignments', async () => {
  await seed();
  await runMigration({ apply: true });
  await runMigration({ apply: true });

  assert.equal(await Client.countDocuments(), 2);
  assert.equal(await AccessAssignment.countDocuments(), 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/access/__tests__/migration.test.js`
Expected: FAIL — `migration.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/modules/access/migration.js
import Project from '../projects/project.model.js';
import User from '../users/user.model.js';
import Client from '../clients/client.model.js';
import AccessAssignment from './accessAssignment.model.js';
import AuditLog from './auditLog.model.js';
import { initGlobalAdminCount } from './globalAdminGuard.js';

const MIGRATED_ENVIRONMENTS = ['Development', 'Staging', 'Production'];

async function findMigrationActor() {
  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  return admin ?? User.findOne({}).sort({ createdAt: 1 });
}

async function planClients() {
  const brands = await Project.distinct('brand', { client: null });
  const existingNames = new Set((await Client.find({}).select('name')).map((c) => c.name));
  return brands.filter(Boolean).filter((b) => !existingNames.has(b));
}

async function planAssignments() {
  const users = await User.find({}).select('_id role');
  const alreadyMigrated = new Set(
    (await AccessAssignment.find({}).select('user')).map((a) => String(a.user)),
  );
  return users.filter((u) => !alreadyMigrated.has(String(u._id)));
}

function summarizeByRole(users) {
  const byRole = {};
  for (const u of users) byRole[u.role] = (byRole[u.role] || 0) + 1;
  return byRole;
}

/**
 * Idempotent by construction: planClients()/planAssignments() only ever plan
 * what doesn't already exist, so running apply twice (e.g. a re-run after a
 * partial failure) is safe — see design spec §10's dry-run/backup/apply/
 * cutover split.
 */
export async function runMigration({ apply = false } = {}) {
  const newClientNames = await planClients();
  const usersToMigrate = await planAssignments();

  const report = {
    apply,
    clientsToCreate: newClientNames,
    usersToMigrate: usersToMigrate.length,
    byRole: summarizeByRole(usersToMigrate),
    note: 'Every migrated user temporarily retains unrestricted access '
      + `(${MIGRATED_ENVIRONMENTS.join(', ')}) — narrow access via the Grant Access UI after cutover.`,
  };

  if (!apply) return report;

  const actor = await findMigrationActor();

  for (const name of newClientNames) {
    const client = await Client.create({ name, createdBy: actor._id });
    await Project.updateMany({ brand: name, client: null }, { $set: { client: client._id } });
  }

  for (const user of usersToMigrate) {
    const assignment = await AccessAssignment.create({
      user: user._id, role: user.role, client: null, project: null,
      environments: MIGRATED_ENVIRONMENTS, grantedBy: actor._id,
    });
    await AuditLog.create({
      actor: actor._id, action: 'ACCESS_GRANTED', targetType: 'AccessAssignment',
      targetId: assignment._id, before: null,
      after: { role: assignment.role, client: null, environments: MIGRATED_ENVIRONMENTS },
      reason: 'Phase 1 migration — preserves prior unrestricted access',
    });
  }

  const globalAdminCount = await AccessAssignment.countDocuments({
    role: 'admin', client: null, status: 'active',
  });
  await initGlobalAdminCount(globalAdminCount);

  return {
    ...report, applied: true, clientsCreated: newClientNames.length,
    assignmentsCreated: usersToMigrate.length, globalAdminCount,
  };
}
```

```js
// backend/scripts/migrate-phase1-access-control.js
import { loadConfig } from '../src/platform/config.js';
import { connectDb, disconnectDb } from '../src/platform/db.js';
import logger from '../src/platform/logger.js';
import { runMigration } from '../src/modules/access/migration.js';

const APPLY = process.argv.includes('--apply');

async function main() {
  const config = loadConfig();
  await connectDb(config.mongoUrl);
  try {
    const report = await runMigration({ apply: APPLY });
    logger.info(APPLY ? 'Migration applied' : 'Migration dry run complete', report);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  logger.error('Migration failed', { message: err.message, stack: err.stack });
  process.exitCode = 1;
});
```

Modify `backend/package.json` — add one script (alongside the existing `test`/`dev`/`start`):

```json
  "scripts": {
    "test": "node --test \"**/*.test.js\"",
    "dev": "node --watch --watch-path=./src --watch-path=../shared src/index.js",
    "start": "node src/index.js",
    "migrate:access-control": "node scripts/migrate-phase1-access-control.js"
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/modules/access/__tests__/migration.test.js`
Expected: PASS, all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/access/migration.js backend/scripts/migrate-phase1-access-control.js backend/src/modules/access/__tests__/migration.test.js backend/package.json
git commit -m "feat(access): add Phase 1 migration script (dry-run + apply, idempotent)"
```

---

## Task 15: Cutover — users and teams routes from requireRole to requirePermission

**Files:**
- Modify: `backend/src/modules/users/user.route.js`
- Modify: `backend/src/modules/teams/team.route.js`
- Create: `backend/src/modules/users/__tests__/user.routes.permission.test.js`
- Create: `backend/src/modules/teams/__tests__/team.routes.permission.test.js`

**Interfaces:**
- Consumes: `requirePermission` (Task 8).
- Note: these are ADDITIVE test files, not replacements for the existing `user.routes.test.js`/any existing teams route tests — run those too in Step 4 to confirm no regression.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/users/__tests__/user.routes.permission.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../user.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import { createApp } from '../../../app.js';
import { generateAccessToken } from '../../auth/token.service.js';

withMemoryDb();

const config = {
  nodeEnv: 'test', isProduction: false, port: 4000, mongoUrl: 'mongodb://unused',
  frontendBaseUrl: 'http://localhost:3000', corsOrigins: ['http://localhost:3000'],
  jwt: { secret: 'a-sufficiently-long-test-secret-value-here', accessExpirationMinutes: 15, refreshExpirationDays: 30 },
  cookie: { domain: undefined, secure: false },
  features: { attachments: false, email: false, seed: false },
  storage: null, email: null, seed: null,
};
const app = () => createApp(config);
const bearer = (user) => `Bearer ${generateAccessToken(user, config)}`;
const activeUser = (n) => User.create({
  name: n, email: `${n}@example.com`, password: 'a-long-enough-password', status: 'active',
});

test('a global admin can list users; a member with no assignment cannot', async () => {
  const admin = await activeUser('admin');
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });
  const member = await activeUser('member');

  await request(app()).get('/v1/users').set('Authorization', bearer(admin)).expect(200);
  await request(app()).get('/v1/users').set('Authorization', bearer(member)).expect(403);
});

test('a member can still PATCH their own /me profile with no assignment at all', async () => {
  const member = await activeUser('me1');
  await request(app())
    .patch('/v1/users/me')
    .set('Authorization', bearer(member))
    .send({ name: 'New Name' })
    .expect(200);
});
```

```js
// backend/src/modules/teams/__tests__/team.routes.permission.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Client from '../../clients/client.model.js';
import Project from '../../projects/project.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import { createApp } from '../../../app.js';
import { generateAccessToken } from '../../auth/token.service.js';

withMemoryDb();

const config = {
  nodeEnv: 'test', isProduction: false, port: 4000, mongoUrl: 'mongodb://unused',
  frontendBaseUrl: 'http://localhost:3000', corsOrigins: ['http://localhost:3000'],
  jwt: { secret: 'a-sufficiently-long-test-secret-value-here', accessExpirationMinutes: 15, refreshExpirationDays: 30 },
  cookie: { domain: undefined, secure: false },
  features: { attachments: false, email: false, seed: false },
  storage: null, email: null, seed: null,
};
const app = () => createApp(config);
const bearer = (user) => `Bearer ${generateAccessToken(user, config)}`;
const activeUser = (n) => User.create({
  name: n, email: `${n}@example.com`, password: 'a-long-enough-password', status: 'active',
});

test('a project-scoped lead can create a team on their own project but not a global team', async () => {
  const lead = await activeUser('lead');
  const client = await Client.create({ name: 'Acme', createdBy: lead._id });
  const project = await Project.create({
    key: 'WEB', name: 'Web', client: client._id, createdBy: lead._id,
  });
  await AccessAssignment.create({
    user: lead._id, role: 'lead', client: client._id, project: project._id, grantedBy: lead._id,
  });

  await request(app())
    .post('/v1/teams')
    .set('Authorization', bearer(lead))
    .send({ name: 'Web Squad', project: String(project._id) })
    .expect(201);

  await request(app())
    .post('/v1/teams')
    .set('Authorization', bearer(lead))
    .send({ name: 'Global Squad' })
    .expect(403);
});

test('a member with no assignment cannot create any team', async () => {
  const member = await activeUser('member');
  await request(app())
    .post('/v1/teams')
    .set('Authorization', bearer(member))
    .send({ name: 'Nope' })
    .expect(403);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/users/__tests__/user.routes.permission.test.js backend/src/modules/teams/__tests__/team.routes.permission.test.js`
Expected: FAIL — both route files still use `requireRole`, so a `member` with zero `AccessAssignment`s still passes today's flat-role gate at `role: 'member'` in some cases and fails differently than expected here.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/modules/users/user.route.js
import express from 'express';
import { auth, requirePermission } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import { resendInviteLimiter } from '../../platform/rateLimit.js';
import * as controller from './user.controller.js';
import {
  listUsersSchema, createUserSchema, userIdSchema, updateUserSchema, updateMeSchema, notificationPrefsSchema,
} from './user.validation.js';

export default function userRoutes(config, deliverInvite) {
  const router = express.Router();
  router.use(auth(config));

  router.patch('/me', validate(updateMeSchema), controller.updateMe);
  router.patch('/me/notification-prefs',
    validate(notificationPrefsSchema), controller.notificationPrefs);

  router.get('/', validate(listUsersSchema), requirePermission('users.view'), controller.list);
  router.post('/', validate(createUserSchema), requirePermission('users.manage'),
    controller.create(deliverInvite));
  router.get('/:id', validate(userIdSchema), requirePermission('users.view'), controller.get);
  router.patch('/:id', validate(updateUserSchema), requirePermission('users.manage'), controller.update);
  router.delete('/:id', validate(userIdSchema), requirePermission('users.manage'), controller.remove);
  router.post('/:id/resend-invite', validate(userIdSchema), requirePermission('users.manage'),
    resendInviteLimiter, controller.resendInvite(deliverInvite));

  return router;
}
```

```js
// backend/src/modules/teams/team.route.js
import express from 'express';
import { auth, requirePermission } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import * as controller from './team.controller.js';
import {
  listTeamsSchema, createTeamSchema, teamIdSchema, updateTeamSchema, updateMembersSchema,
} from './team.validation.js';
import Team from './team.model.js';

/** A global team (project: null) requires a global AccessAssignment — this
 * IS the "global team" edge case from the design spec §4.5, not a special
 * case: resolveScope({projectId: null}) simply returns clientId: null too. */
async function resolveTeamScope(req) {
  const team = await Team.findById(req.params.id).select('project');
  return { projectId: team?.project ?? null };
}

export default function teamRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', validate(listTeamsSchema), controller.list);
  router.post('/', validate(createTeamSchema),
    requirePermission('teams.manage', (req) => ({ projectId: req.body.project ?? null })),
    controller.create);
  router.get('/:id', validate(teamIdSchema), controller.get);
  router.patch('/:id', validate(updateTeamSchema),
    requirePermission('teams.manage', resolveTeamScope), controller.update);
  router.patch('/:id/members', validate(updateMembersSchema),
    requirePermission('teams.manage', resolveTeamScope), controller.members);

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/modules/users/__tests__/*.test.js backend/src/modules/teams/__tests__/*.test.js`
Expected: PASS, including both new files AND every pre-existing test in these two modules (`user.routes.test.js`, `user.model.test.js`, `team.service.test.js`) — if any pre-existing test asserted `requireRole`-flavored behavior (a plain `role: 'admin'` field on the actor being sufficient with no `AccessAssignment`), it will now fail and needs updating to also create the matching `AccessAssignment` for that actor, in this same step.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/users/user.route.js backend/src/modules/teams/team.route.js backend/src/modules/users/__tests__/user.routes.permission.test.js backend/src/modules/teams/__tests__/team.routes.permission.test.js
git commit -m "refactor(access): cut users and teams routes over from requireRole to requirePermission"
```

---

## Task 16: Cutover — projects route requires a Client, listing is scope-filtered

**Files:**
- Modify: `backend/src/modules/projects/project.validation.js`
- Modify: `backend/src/modules/projects/project.service.js`
- Modify: `backend/src/modules/projects/project.controller.js`
- Modify: `backend/src/modules/projects/project.route.js`
- Create: `backend/src/modules/projects/__tests__/project.access.test.js`

**Interfaces:**
- Consumes: `requirePermission` (Task 8), `effectiveScope` (Task 6), `Client` (Task 2).
- `listProjects` signature changes from `(query)` to `(actor, query)` — its one existing call site (`project.controller.js`'s `list`) is updated in this same task.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/projects/__tests__/project.access.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Client from '../../clients/client.model.js';
import Project from '../project.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import { createApp } from '../../../app.js';
import { generateAccessToken } from '../../auth/token.service.js';
import { listProjects } from '../project.service.js';

withMemoryDb();

const config = {
  nodeEnv: 'test', isProduction: false, port: 4000, mongoUrl: 'mongodb://unused',
  frontendBaseUrl: 'http://localhost:3000', corsOrigins: ['http://localhost:3000'],
  jwt: { secret: 'a-sufficiently-long-test-secret-value-here', accessExpirationMinutes: 15, refreshExpirationDays: 30 },
  cookie: { domain: undefined, secure: false },
  features: { attachments: false, email: false, seed: false },
  storage: null, email: null, seed: null,
};
const app = () => createApp(config);
const bearer = (user) => `Bearer ${generateAccessToken(user, config)}`;
const activeUser = (n) => User.create({
  name: n, email: `${n}@example.com`, password: 'a-long-enough-password', status: 'active',
});

test('creating a project requires a client and requires projects.manage scoped to it', async () => {
  const scopedAdmin = await activeUser('scoped');
  const clientA = await Client.create({ name: 'Acme', createdBy: scopedAdmin._id });
  const clientB = await Client.create({ name: 'Globex', createdBy: scopedAdmin._id });
  await AccessAssignment.create({
    user: scopedAdmin._id, role: 'admin', client: clientA._id, grantedBy: scopedAdmin._id,
  });

  await request(app())
    .post('/v1/projects')
    .set('Authorization', bearer(scopedAdmin))
    .send({ client: String(clientA._id), brand: 'Acme', name: 'Website' })
    .expect(201);

  await request(app())
    .post('/v1/projects')
    .set('Authorization', bearer(scopedAdmin))
    .send({ client: String(clientB._id), brand: 'Globex', name: 'ERP' })
    .expect(403);
});

test('a request missing client fails validation, not a service-level default', async () => {
  const admin = await activeUser('admin');
  await AccessAssignment.create({ user: admin._id, role: 'admin', grantedBy: admin._id });

  const res = await request(app())
    .post('/v1/projects')
    .set('Authorization', bearer(admin))
    .send({ brand: 'Acme', name: 'Website' })
    .expect(400);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('listProjects returns only projects the actor is scoped to', async () => {
  const actor = await activeUser('lister');
  const clientA = await Client.create({ name: 'Acme', createdBy: actor._id });
  const clientB = await Client.create({ name: 'Globex', createdBy: actor._id });
  const pA = await Project.create({ key: 'WEB', name: 'Web', client: clientA._id, createdBy: actor._id });
  await Project.create({ key: 'ERP', name: 'ERP', client: clientB._id, createdBy: actor._id });
  await AccessAssignment.create({
    user: actor._id, role: 'member', client: clientA._id, grantedBy: actor._id,
  });

  const page = await listProjects(actor, {});
  assert.deepEqual(page.results.map((p) => p.id), [pA.id]);
});

test('listProjects returns everything for a global-scope actor', async () => {
  const actor = await activeUser('globallister');
  const clientA = await Client.create({ name: 'Acme', createdBy: actor._id });
  await Project.create({ key: 'WEB', name: 'Web', client: clientA._id, createdBy: actor._id });
  await AccessAssignment.create({ user: actor._id, role: 'admin', grantedBy: actor._id });

  const page = await listProjects(actor, {});
  assert.equal(page.results.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/projects/__tests__/project.access.test.js`
Expected: FAIL — `client` isn't a create field yet, `listProjects` doesn't take an actor.

- [ ] **Step 3: Write minimal implementation**

Modify `backend/src/modules/projects/project.validation.js` — add `client` to `createProjectSchema` only (not `updateProjectSchema` — reassigning a project's client is explicitly not a Phase 1 operation, per the design spec):

```js
export const createProjectSchema = {
  body: Joi.object({
    client: objectId.required(),
    brand: Joi.string().trim().min(1).max(80).required(),
    key: Joi.string().trim().uppercase().pattern(/^[A-Z][A-Z0-9]{1,9}$/),
    name: Joi.string().trim().min(1).max(120).required(),
    description: Joi.string().trim().max(1000).allow(''),
    defaultAssignee: objectId.allow(null),
    defaultTester: objectId.allow(null),
    defaultTeam: objectId.allow(null),
    modules: Joi.array().items(moduleItem).default([]),
  }),
};
```

Modify `backend/src/modules/projects/project.service.js` — import `Client` and `effectiveScope`, extend `createProject`, rewrite `listProjects`:

```js
import { resolveProjectModules } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import { effectiveScope } from '../../platform/authorize.js';
import Team from '../teams/team.model.js';
import { assertActiveUsers, assertTeamUsable } from '../teams/team.service.js';
import Client from '../clients/client.model.js';
import Project, { RESERVED_PROJECT_KEYS } from './project.model.js';

// ... deriveProjectKeyBase, resolveAvailableProjectKey, assertCreateDefaults,
//     assertModuleAndPage, assertDefaults unchanged ...

export async function createProject(actor, body) {
  const brand = String(body.brand || '').trim();
  if (!brand) {
    throw new ApiError(400, 'BRAND_REQUIRED', 'Brand is required');
  }

  const client = await Client.findById(body.client);
  if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Client not found');
  if (client.status !== 'active') {
    throw new ApiError(400, 'CLIENT_ARCHIVED', 'Cannot create a project under an archived client');
  }

  await assertCreateDefaults(body);

  const key = await resolveAvailableProjectKey(body.name, body.key);
  if (RESERVED_PROJECT_KEYS.includes(key)) {
    throw new ApiError(400, 'RESERVED_PROJECT_KEY', `"${key}" is reserved for imported legacy tickets`);
  }
  if (await Project.exists({ key })) {
    throw new ApiError(400, 'PROJECT_KEY_TAKEN', `A project with key "${key}" already exists`);
  }

  const project = await Project.create({
    brand,
    client: client._id,
    key,
    name: body.name,
    description: body.description,
    modules: body.modules ?? [],
    defaultAssignee: body.defaultAssignee || undefined,
    defaultTester: body.defaultTester || undefined,
    defaultTeam: body.defaultTeam || undefined,
    createdBy: actor._id,
  });

  const populated = await Project.findById(project._id)
    .populate(['defaultAssignee', 'defaultTester', 'defaultTeam']);
  return populated.toJSON();
}

export async function listBrands() {
  const brands = await Project.distinct('brand', { status: 'active' });
  return brands.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export async function listProjects(actor, query = {}) {
  const filter = { status: query.status || 'active' };

  const scope = await effectiveScope(actor._id);
  if (!scope.allClients) {
    filter.$or = [
      { client: { $in: scope.clientIds } },
      { _id: { $in: scope.projectIds } },
    ];
  }

  const page = await paginate(Project, filter, {
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy || 'name:asc,key:asc',
    populate: ['defaultAssignee', 'defaultTester', 'defaultTeam'],
  });
  return { ...page, results: page.results.map((p) => p.toJSON()) };
}

// ... getProject, updateProject, replaceModules unchanged ...
```

Modify `backend/src/modules/projects/project.controller.js` — one line:

```js
export const list = catchAsync(async (req, res) => {
  res.json(await projectService.listProjects(req.user, req.query));
});
```

Modify `backend/src/modules/projects/project.route.js`:

```js
import express from 'express';
import { auth, requirePermission } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import * as controller from './project.controller.js';
import {
  listProjectsSchema, createProjectSchema, projectIdSchema,
  updateProjectSchema, replaceModulesSchema,
} from './project.validation.js';

export default function projectRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', validate(listProjectsSchema), controller.list);
  router.get('/brands', controller.listBrands);
  router.post('/', validate(createProjectSchema),
    requirePermission('projects.manage', (req) => ({ clientId: req.body.client })), controller.create);
  router.get('/:id', validate(projectIdSchema), controller.get);
  router.patch('/:id', validate(updateProjectSchema),
    requirePermission('projects.manage', (req) => ({ projectId: req.params.id })), controller.update);
  router.put('/:id/modules', validate(replaceModulesSchema),
    requirePermission('projects.manage', (req) => ({ projectId: req.params.id })), controller.modules);

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/modules/projects/__tests__/*.test.js`
Expected: PASS, including the new file AND `project.model.test.js`/`project.service.test.js` — the existing `project.service.test.js` calls `createProject`/`listProjects` directly and will need its fixtures updated in this step to create a `Client` and pass it as `body.client`, and to pass an `actor` to `listProjects`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/projects/project.validation.js backend/src/modules/projects/project.service.js backend/src/modules/projects/project.controller.js backend/src/modules/projects/project.route.js backend/src/modules/projects/__tests__/project.access.test.js
git commit -m "refactor(access): projects require a Client; listing is scope-filtered"
```

---

## Task 17: Cutover — tickets are the real tenant-isolation boundary

**Why this is the most important task in the plan, not a routine cutover:** `tickets.route.js`'s only literal `requireRole` call site is `DELETE /:id`. But the actual "does this user see only their own client's data" guarantee — the whole reason this subsystem exists — lives in `ticket.service.js`'s inline `actor.role === 'admin' || actor.role === 'lead'` checks (`applyTicketVisibility`, `assertCanViewTicket`, `assertCanEditTicket`, `assignTicket`), which are not route middleware at all. Replacing only the one `requireRole` call site would leave every ticket in the system visible to any `admin`/`lead`-labeled user regardless of client, which is precisely the cross-client leak this whole design exists to close. This task replaces all four.

**Cascading signature change — `assertCanEditTicket` becomes `async`:** it now calls `can()`, which does a DB read. Its callers must all add `await`. Traced exhaustively via `grep -rn assertCanEditTicket`:
- `ticket.service.js:290` (`patchTicket`), `:374` (`setBlocked`), `:408` (`clearBlocked`) — already `async function`, just add `await`.
- `attachment.service.js:61` — already `async function`, add `await`.
- `transition.service.js:47`, inside `assertMayTransition` — currently a **synchronous** function; it must become `async` too, which makes its own one call site, `transition.service.js:70` inside `transitionTicket` (already `async`), need `await` added as well.
- `ticket.service.js`'s own test suite calls it directly (see Step 3's test-file edits below).

**Files:**
- Modify: `backend/src/modules/tickets/ticket.service.js`
- Modify: `backend/src/modules/tickets/transition.service.js`
- Modify: `backend/src/modules/tickets/attachment.service.js`
- Modify: `backend/src/modules/tickets/ticket.route.js`
- Modify: `backend/src/modules/tickets/__tests__/ticket.patch.test.js`
- Create: `backend/src/modules/tickets/__tests__/ticket.access.test.js`

**Interfaces:**
- Consumes: `can`, `effectiveScope` (Task 6).
- `assertCanEditTicket(actor, ticket)` becomes `async (actor, ticket) => Promise<void>` (was sync) — a breaking signature change for every caller listed above.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/tickets/__tests__/ticket.access.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Client from '../../clients/client.model.js';
import Project from '../../projects/project.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import {
  createTicket, listTickets, getTicket, assertCanViewTicket, assertCanEditTicket, assignTicket,
} from '../ticket.service.js';

withMemoryDb();

const user = (n) => User.create({
  name: n, email: `${n}@example.com`, password: 'a-long-enough-password', status: 'active',
});

async function seedTwoClients() {
  const reporter = await user('reporter');
  const clientA = await Client.create({ name: 'Acme', createdBy: reporter._id });
  const clientB = await Client.create({ name: 'Globex', createdBy: reporter._id });
  const projectA = await Project.create({
    key: 'WEB', name: 'Web', client: clientA._id, createdBy: reporter._id,
  });
  const projectB = await Project.create({
    key: 'ERP', name: 'ERP', client: clientB._id, createdBy: reporter._id,
  });
  const ticketA = await createTicket(reporter, { project: projectA.id, title: 'Bug in Acme' });
  const ticketB = await createTicket(reporter, { project: projectB.id, title: 'Bug in Globex' });
  return { reporter, clientA, clientB, projectA, projectB, ticketA, ticketB };
}

test('a user scoped only to client A cannot view a client-B ticket, even by direct id', async () => {
  const { clientA, ticketB } = await seedTwoClients();
  const scoped = await user('scoped');
  await AccessAssignment.create({
    user: scoped._id, role: 'qa', client: clientA._id, environments: ['Staging'], grantedBy: scoped._id,
  });

  await assert.rejects(
    () => getTicket(scoped, ticketB.ticketId),
    (err) => err.statusCode === 403,
  );
});

test('the same user CAN view a client-A ticket', async () => {
  const { clientA, ticketA } = await seedTwoClients();
  const scoped = await user('scoped2');
  await AccessAssignment.create({
    user: scoped._id, role: 'qa', client: clientA._id, environments: ['Staging'], grantedBy: scoped._id,
  });

  const found = await getTicket(scoped, ticketA.ticketId);
  assert.equal(found.id, ticketA.id);
});

test('listTickets for a client-A-scoped user never includes a client-B ticket', async () => {
  const { clientA } = await seedTwoClients();
  const scoped = await user('scoped3');
  await AccessAssignment.create({
    user: scoped._id, role: 'qa', client: clientA._id, environments: ['Staging'], grantedBy: scoped._id,
  });

  const page = await listTickets(scoped, {});
  assert.ok(page.results.every((t) => t.title !== 'Bug in Globex'));
});

test('a global-scope user still sees tickets across both clients', async () => {
  const { reporter } = await seedTwoClients();
  await AccessAssignment.create({ user: reporter._id, role: 'admin', grantedBy: reporter._id });

  const page = await listTickets(reporter, {});
  assert.equal(page.results.length, 2);
});

test('assignTicket requires tickets.assign at the ticket\'s project scope, not merely visibility', async () => {
  const { clientA, projectA, ticketA } = await seedTwoClients();
  const qa = await user('qa1');
  await AccessAssignment.create({
    user: qa._id, role: 'qa', client: clientA._id, environments: ['Staging'], grantedBy: qa._id,
  });
  const target = await user('target');

  await assert.rejects(
    () => assignTicket(qa, ticketA.ticketId, { assignedTo: target._id, revision: 0 }),
    (err) => err.statusCode === 403,
  );

  const lead = await user('lead1');
  await AccessAssignment.create({
    user: lead._id, role: 'lead', client: clientA._id, project: projectA._id,
    environments: ['Staging'], grantedBy: lead._id,
  });
  const assigned = await assignTicket(lead, ticketA.ticketId, { assignedTo: target._id, revision: 0 });
  assert.equal(String(assigned.assignedTo), String(target._id));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/tickets/__tests__/ticket.access.test.js`
Expected: FAIL — today's role-based checks let anyone through (no `role: 'admin'`/`'lead'` field is set on any of these test users, so today's checks fall to the ownership path, but they're also not the reporter — the exact behavior will vary; the point is the assertions above don't hold yet either way).

- [ ] **Step 3: Write minimal implementation**

Modify `backend/src/modules/tickets/ticket.service.js` — add the import, then replace the four functions:

```js
import { can, effectiveScope } from '../../platform/authorize.js';
import Project from '../projects/project.model.js';
// ... existing imports (Team, ApiError, etc.) stay ...

async function projectIdsInScope(scope) {
  if (scope.allClients) return null; // null = no restriction
  const fromClients = scope.clientIds.length
    ? await Project.find({ client: { $in: scope.clientIds } }).distinct('_id')
    : [];
  return [...new Set([...fromClients.map(String), ...scope.projectIds])];
}

async function applyTicketVisibility(filter, actor) {
  const scope = await effectiveScope(actor._id);
  const scopedProjectIds = await projectIdsInScope(scope);
  if (scopedProjectIds === null) return filter;

  const teamIds = await actorTeamIds(actor._id);
  const visibility = {
    $or: [...ticketVisibilityOr(actor._id, teamIds), { project: { $in: scopedProjectIds } }],
  };
  if (Object.keys(filter).length === 0) return visibility;
  return { $and: [filter, visibility] };
}

export async function assertCanViewTicket(actor, ticket) {
  const projectId = ticket.project?._id ?? ticket.project;
  if (await can(actor, 'tickets.view', { projectId, environment: ticket.environment })) return;

  if (sameId(ticket.createdBy, actor._id) || sameId(ticket.assignedTo, actor._id)) return;
  if ((ticket.watchers || []).some((watcher) => sameId(watcher, actor._id))) return;
  if (await isActorOnTicketTeam(actor._id, ticket)) return;

  throw new ApiError(
    403, 'FORBIDDEN',
    'Only the reporter, assignee, watcher, team member, or someone with access to this project may view this ticket',
  );
}

export async function assertCanEditTicket(actor, ticket) {
  const projectId = ticket.project?._id ?? ticket.project;
  const privileged = await can(actor, 'tickets.update', { projectId, environment: ticket.environment });
  const related = sameId(ticket.createdBy, actor._id) || sameId(ticket.assignedTo, actor._id);

  if (!privileged && !related) {
    throw new ApiError(
      403, 'FORBIDDEN',
      'Only the reporter, the assignee, or someone with access to this project may edit this ticket',
    );
  }
}
```

In `assignTicket` (unchanged surrounding logic — only the role check is replaced):

```js
export async function assignTicket(actor, idOrKey, { assignedTo, team, revision }) {
  const ticket = await resolveTicketDoc(idOrKey);

  const allowed = await can(actor, 'tickets.assign', {
    projectId: ticket.project, environment: ticket.environment,
  });
  if (!allowed) {
    throw new ApiError(
      403, 'FORBIDDEN', 'Only someone with ticket-assignment access to this project may assign tickets',
    );
  }

  // ... rest of the function body (patch/changes/assertActiveUsers/etc.) unchanged ...
}
```

Add `await` at the three in-module call sites (no other change on these lines):

```js
// ticket.service.js:290 (patchTicket), :374 (setBlocked), :408 (clearBlocked)
  await assertCanEditTicket(actor, ticket);
```

Modify `backend/src/modules/tickets/attachment.service.js:61`:

```js
  await assertCanEditTicket(actor, ticket);
```

Modify `backend/src/modules/tickets/transition.service.js`:

```js
/** Layer 2 for this endpoint: the same relationship rule as an ordinary edit. */
export async function assertMayTransition(actor, ticket) {
  await assertCanEditTicket(actor, ticket);
}
```

And its one call site, `transition.service.js:70` inside `transitionTicket` (already `async`):

```js
  await assertMayTransition(actor, ticket);
```

Modify `backend/src/modules/tickets/ticket.route.js` — only the delete route changes:

```js
import express from 'express';
import { auth, requirePermission } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import { uploadMiddleware } from '../../platform/upload.js';
import * as controller from './ticket.controller.js';
import Ticket from './ticket.model.js';
import { ApiError } from '../../platform/errors.js';
import {
  listTicketsSchema, createTicketSchema, ticketIdSchema,
  patchTicketSchema, assignTicketSchema, bulkSchema,
  transitionSchema, addCommentSchema, commentIdSchema,
  editCommentSchema, reactionSchema, attachmentIdSchema, addAttachmentsSchema,
  setBlockedSchema, clearBlockedSchema,
} from './ticket.validation.js';

async function resolveTicketScope(req) {
  const ticket = await Ticket.findById(req.params.id).select('project environment');
  if (!ticket) throw new ApiError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
  return { projectId: ticket.project, environment: ticket.environment };
}

export default function ticketRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', validate(listTicketsSchema), controller.list);
  router.post('/', validate(createTicketSchema), controller.create(config));

  router.post('/bulk', validate(bulkSchema), controller.bulk);

  router.get('/:id', validate(ticketIdSchema), controller.get);
  router.patch('/:id', validate(patchTicketSchema), controller.patch(config));
  router.delete('/:id', validate(ticketIdSchema),
    requirePermission('tickets.delete', resolveTicketScope), controller.remove);

  // ... every other route below (assign/transition/watch/block/comments/attachments)
  //     is unchanged — their authorization now runs inside ticket.service.js /
  //     transition.service.js / attachment.service.js, exactly as ownership
  //     checks already did before this task.
  router.post('/:id/assign', validate(assignTicketSchema), controller.assign(config));
  router.post('/:id/transition', validate(transitionSchema), controller.transition(config));
  router.post('/:id/watch', validate(ticketIdSchema), controller.watch);
  router.delete('/:id/watch', validate(ticketIdSchema), controller.unwatch);
  router.post('/:id/block', validate(setBlockedSchema), controller.setBlocked);
  router.delete('/:id/block', validate(clearBlockedSchema), controller.clearBlocked);

  router.post('/:id/comments', validate(addCommentSchema), controller.addComment(config));
  router.patch('/:id/comments/:commentId', validate(editCommentSchema), controller.editComment);
  router.delete('/:id/comments/:commentId', validate(commentIdSchema), controller.deleteComment);
  router.put('/:id/comments/:commentId/reactions',
    validate(reactionSchema), controller.reactToComment);

  router.post('/:id/attachments', uploadMiddleware,
    validate(addAttachmentsSchema), controller.addAttachments(config));
  router.delete('/:id/attachments/:attachmentId',
    validate(attachmentIdSchema), controller.removeAttachment(config));
  router.get('/:id/attachments/:attachmentId/download',
    validate(attachmentIdSchema), controller.downloadAttachment(config));

  return router;
}
```

Modify `backend/src/modules/tickets/__tests__/ticket.patch.test.js` — two existing tests need updating for the new async signature AND for the fact that a bare `role: 'lead'` field no longer grants anything on its own:

```js
// add to the import list at the top of the file:
import AccessAssignment from '../../access/accessAssignment.model.js';

// replace the two tests at the bottom of the file:
test('a member who is neither reporter nor assignee cannot edit', async () => {
  const { ticket } = await seed();
  const stranger = await user('member');
  const doc = await Ticket.findById(ticket.id);

  await assert.rejects(
    () => assertCanEditTicket(stranger, doc),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
});

test('someone with tickets.update access to the project may edit any ticket; the assignee may edit their own', async () => {
  const { ticket } = await seed();
  const lead = await user('lead');
  await AccessAssignment.create({ user: lead._id, role: 'lead', grantedBy: lead._id }); // global scope
  const assignee = await user();

  await Ticket.updateOne({ _id: ticket.id }, { $set: { assignedTo: assignee._id } });
  const doc = await Ticket.findById(ticket.id);

  await assert.doesNotReject(() => assertCanEditTicket(lead, doc));
  await assert.doesNotReject(() => assertCanEditTicket(assignee, doc));
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test backend/src/modules/tickets/__tests__/*.test.js`
Expected: PASS, including the new `ticket.access.test.js` AND the entire existing tickets suite (`ticket.patch.test.js`, `ticket.create.test.js`, `ticket.blocked.test.js`, `transition.routes.test.js`, `transition.service.test.js`, `attachment.service.test.js`, `comment.service.test.js`, `ticket.list.test.js`, `ticket.routes.test.js`, `analytics.*.test.js`). This is the highest-regression-risk step in the whole plan — any existing test that relied on a bare `role: 'admin'`/`'lead'` field for privileged behavior (with no matching `AccessAssignment`) will now fail and needs an `AccessAssignment.create(...)` added to its fixture, following the pattern in the two tests updated above. Read each failure's assertion before changing it — the goal is preserving the test's original intent under the new model, not just making it pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/tickets/ticket.service.js backend/src/modules/tickets/transition.service.js backend/src/modules/tickets/attachment.service.js backend/src/modules/tickets/ticket.route.js backend/src/modules/tickets/__tests__/ticket.patch.test.js backend/src/modules/tickets/__tests__/ticket.access.test.js
git commit -m "refactor(access): tickets view/edit/assign are scope-and-permission-aware, closing the actual cross-client leak"
```

---

Backend is now feature-complete for Phase 1. The remaining tasks are frontend.

## Task 18: Frontend API wrapper modules

**Files:**
- Create: `frontend/shared/lib/query-string.js`
- Create: `frontend/shared/lib/__tests__/query-string.test.js`
- Create: `frontend/shared/api/clients.js`
- Create: `frontend/shared/api/access.js`
- Create: `frontend/shared/api/audit.js`

**Interfaces:**
- Produces: `toQuery(params): string`; `listClients`, `createClient`, `patchClient`; `listAccessAssignments`, `grantAccess`, `patchAccess`, `revokeAccess`; `listAuditLog` — same `apiFetch`-wrapping shape as `frontend/shared/api/teams.js`. Consumed by Tasks 19-21.

- [ ] **Step 1: Write the failing test**

```js
// frontend/shared/lib/__tests__/query-string.test.js
import { describe, it, expect } from 'vitest';
import { toQuery } from '../query-string.js';

describe('toQuery', () => {
  it('returns an empty string for no params', () => {
    expect(toQuery()).toBe('');
    expect(toQuery({})).toBe('');
  });

  it('skips undefined, null, and empty-string values', () => {
    expect(toQuery({ a: undefined, b: null, c: '', d: 'x' })).toBe('?d=x');
  });

  it('joins multiple params with &', () => {
    const qs = toQuery({ action: 'CLIENT_CREATED', page: 2 });
    expect(qs).toBe('?action=CLIENT_CREATED&page=2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run shared/lib/__tests__/query-string.test.js`
Expected: FAIL — `query-string.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// frontend/shared/lib/query-string.js
/** Builds a `?a=b&c=d` string, skipping undefined/null/empty values. */
export function toQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}
```

```js
// frontend/shared/api/clients.js
import { apiFetch } from './client.js';
import { toQuery } from '../lib/query-string.js';

export const listClients = (params) => apiFetch(`/clients${toQuery(params)}`);
export const createClient = (body) => apiFetch('/clients', { method: 'POST', body });
export const patchClient = (id, body) => apiFetch(`/clients/${id}`, { method: 'PATCH', body });
```

```js
// frontend/shared/api/access.js
import { apiFetch } from './client.js';
import { toQuery } from '../lib/query-string.js';

export const listAccessAssignments = (params) => apiFetch(`/access-assignments${toQuery(params)}`);
export const grantAccess = (body) => apiFetch('/access-assignments', { method: 'POST', body });
export const patchAccess = (id, body) => apiFetch(`/access-assignments/${id}`, { method: 'PATCH', body });
export const revokeAccess = (id, body) => apiFetch(`/access-assignments/${id}`, { method: 'DELETE', body });
```

```js
// frontend/shared/api/audit.js
import { apiFetch } from './client.js';
import { toQuery } from '../lib/query-string.js';

export const listAuditLog = (params) => apiFetch(`/audit-log${toQuery(params)}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run shared/lib/__tests__/query-string.test.js`
Expected: PASS, all 3 cases. The `clients.js`/`access.js`/`audit.js` wrappers are untested directly (no branching logic — pure `apiFetch` calls, matching this codebase's existing `teams.js`/`projects.js`, none of which have dedicated tests either); Tasks 19-21's page-level tests exercise them through `vi.mock()`.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/lib/query-string.js frontend/shared/lib/__tests__/query-string.test.js frontend/shared/api/clients.js frontend/shared/api/access.js frontend/shared/api/audit.js
git commit -m "feat(frontend): add API wrapper modules for clients, access assignments, and audit log"
```

---

## Task 19: Clients page

**A pre-existing frontend gap this task does not fully fix, flagged rather than silently left:** `frontend/shared/components/app-sidebar.jsx`'s nav visibility (`visible(item, role)`) checks the single flat `user.role` string — the same field this whole plan stops using for real authorization after Task 17. Post-cutover, a user's nav visibility can drift from their actual effective permissions (a narrowed `AccessAssignment` with an unchanged legacy `role`, or vice versa). Fully fixing this means computing effective nav visibility from real permissions, which is more than Phase 1's UI scope calls for (the design spec keeps Phase 1's UI intentionally small). This task adds its new nav entries using the *same* existing (now-imperfect) mechanism, matching every other entry already in that file — not introducing a new problem, but not fixing the pre-existing one either. Worth a follow-up task; noted here so it isn't mistaken for an oversight.

**Files:**
- Create: `frontend/app/(app)/clients/page.jsx`
- Create: `frontend/app/(app)/clients/__tests__/clients.test.jsx`
- Modify: `frontend/shared/components/app-sidebar.jsx`

**Interfaces:**
- Consumes: `listClients`, `createClient`, `patchClient` (Task 18), `normalizeApiError`, `showToast` (existing).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/app/(app)/clients/__tests__/clients.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClientsPage from '../page.jsx';

const listClients = vi.fn();
const createClient = vi.fn();
const patchClient = vi.fn();

vi.mock('@/shared/api/clients.js', () => ({
  listClients: (...a) => listClients(...a),
  createClient: (...a) => createClient(...a),
  patchClient: (...a) => patchClient(...a),
}));
vi.mock('@/shared/lib/toast.js', () => ({ showToast: vi.fn() }));

describe('ClientsPage', () => {
  beforeEach(() => {
    listClients.mockReset().mockResolvedValue({
      results: [{ id: 'c1', name: 'Acme', status: 'active' }],
      totalResults: 1,
    });
    createClient.mockReset().mockResolvedValue({ id: 'c2', name: 'Globex', status: 'active' });
    patchClient.mockReset().mockResolvedValue({ id: 'c1', name: 'Acme', status: 'archived' });
  });

  it('lists clients with their status', async () => {
    render(<ClientsPage />);
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('creates a client from the inline form and reloads the list', async () => {
    render(<ClientsPage />);
    await screen.findByText('Acme');

    await userEvent.type(screen.getByLabelText(/new client name/i), 'Globex');
    await userEvent.click(screen.getByRole('button', { name: /add client/i }));

    expect(createClient).toHaveBeenCalledWith({ name: 'Globex' });
    expect(listClients).toHaveBeenCalledTimes(2);
  });

  it('archives a client from its row action', async () => {
    render(<ClientsPage />);
    await screen.findByText('Acme');

    await userEvent.click(screen.getByRole('button', { name: /archive/i }));

    expect(patchClient).toHaveBeenCalledWith('c1', { status: 'archived' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run app/\(app\)/clients/__tests__/clients.test.jsx`
Expected: FAIL — `../page.jsx` does not exist.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/app/(app)/clients/page.jsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { listClients, createClient, patchClient } from '@/shared/api/clients.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [rowBusy, setRowBusy] = useState({});

  const reload = useCallback(() => {
    listClients({ status: 'active' }).then((page) => setClients(page.results)).catch(setError);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      await createClient({ name: trimmed });
      setName('');
      showToast('Client created');
      reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not create client';
      setError(message);
      showToast(message);
    } finally {
      setCreating(false);
    }
  }

  async function toggleArchive(client) {
    const nextStatus = client.status === 'active' ? 'archived' : 'active';
    setRowBusy((prev) => ({ ...prev, [client.id]: true }));
    try {
      await patchClient(client.id, { status: nextStatus });
      showToast(nextStatus === 'archived' ? `${client.name} archived` : `${client.name} reactivated`);
      reload();
    } catch (err) {
      showToast(normalizeApiError(err)?.message || 'Could not update client');
    } finally {
      setRowBusy((prev) => {
        const next = { ...prev };
        delete next[client.id];
        return next;
      });
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Clients</h1>
          <p className="sub">The customers this workspace does project work for.</p>
        </div>
        <span className="spacer" />
      </div>

      <div className="row-actions">
        <input
          aria-label="New client name"
          placeholder="New client name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          disabled={creating}
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={create}
          disabled={creating || !name.trim()}
        >
          {creating ? 'Creating…' : 'Add client'}
        </button>
      </div>
      {error && <p className="row-action-status row-action-status--error">{error}</p>}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id}>
                <td>{client.name}</td>
                <td><span className="chip">{client.status}</span></td>
                <td>
                  <button
                    type="button"
                    className={`btn btn-sm${client.status === 'active' ? ' btn-danger' : ''}`}
                    onClick={() => toggleArchive(client)}
                    disabled={Boolean(rowBusy[client.id])}
                  >
                    {client.status === 'active' ? 'Archive' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

Modify `frontend/shared/components/app-sidebar.jsx` — add one nav item to the existing `Admin` group (`roles: ['admin']` matches Phase 1's role matrix — only `admin` holds `clients.manage`/`clients.view`... note `clients.view` is actually granted to every role per §4.5's matrix, but the nav item gates on the *manage* capability this page exposes, matching how `/projects` already gates on `admin` even though `projects.view` is universal too):

```js
  {
    cap: 'Admin',
    items: [
      { href: '/projects', id: 'projects', label: 'Projects', icon: 'layers', roles: ['admin'] },
      { href: '/clients', id: 'clients', label: 'Clients', icon: 'layers', roles: ['admin'] },
      { href: '/teams', id: 'teams', label: 'Teams', icon: 'teams', roles: ['admin', 'lead'] },
      { href: '/users', id: 'people', label: 'People', icon: 'user', roles: ['admin'] },
      { href: '/settings/notifications', id: 'settings', label: 'Notification settings', icon: 'sliders', roles: '*' },
    ],
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run app/\(app\)/clients/__tests__/clients.test.jsx`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/\(app\)/clients/page.jsx frontend/app/\(app\)/clients/__tests__/clients.test.jsx frontend/shared/components/app-sidebar.jsx
git commit -m "feat(frontend): add Clients page"
```

---

## Task 20: Users & Access — Access Profile drawer and Grant Access dialog

**Scope decision on "step-based flow":** the design spec calls for a step-based wizard (user → client → project → role → environments → review → confirm). Since this launches from a specific user's row, "select user" is already done by the time it opens. Rather than a multi-screen wizard state machine, this task uses one dialog with clearly labeled, ordered sections and a live summary line before the confirm button — the same guided, non-overwhelming intent, without wizard-navigation state to build and test for a Phase 1 UI the spec itself keeps intentionally small.

**Files:**
- Create: `frontend/shared/components/access/access-profile-drawer.jsx`
- Create: `frontend/shared/components/access/grant-access-dialog.jsx`
- Create: `frontend/shared/components/access/__tests__/access-profile-drawer.test.jsx`
- Create: `frontend/shared/components/access/__tests__/grant-access-dialog.test.jsx`
- Modify: `frontend/app/(app)/users/page.jsx`

**Interfaces:**
- Consumes: `listAccessAssignments`, `grantAccess`, `revokeAccess` (Task 18's `access.js`), `listClients` (Task 18's `clients.js`), `listProjects` (existing `projects.js` — takes no params, already scope-filtered server-side by Task 16).
- `AccessProfileDrawer({ open, user, onClose, onGrantNew })`, `GrantAccessDialog({ open, user, onGranted, onCancel })`.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/shared/components/access/__tests__/grant-access-dialog.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GrantAccessDialog from '../grant-access-dialog.jsx';

const grantAccess = vi.fn();
const listClients = vi.fn();
const listProjects = vi.fn();

vi.mock('@/shared/api/access.js', () => ({ grantAccess: (...a) => grantAccess(...a) }));
vi.mock('@/shared/api/clients.js', () => ({ listClients: (...a) => listClients(...a) }));
vi.mock('@/shared/api/projects.js', () => ({ listProjects: (...a) => listProjects(...a) }));

const user = { id: 'u1', name: 'Khushi', email: 'khushi@example.com' };

describe('GrantAccessDialog', () => {
  beforeEach(() => {
    grantAccess.mockReset().mockResolvedValue({ id: 'a1', role: 'qa' });
    listClients.mockReset().mockResolvedValue({ results: [{ id: 'c1', name: 'Acme' }] });
    listProjects.mockReset().mockResolvedValue({
      results: [{ id: 'p1', name: 'Website', client: 'c1' }],
    });
  });

  it('grants global scope by default with no environments, requiring no reason', async () => {
    render(<GrantAccessDialog open user={user} onGranted={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByText('Acme');

    await userEvent.click(screen.getByRole('button', { name: /grant access/i }));

    expect(grantAccess).toHaveBeenCalledWith({
      user: 'u1', role: 'member', client: null, project: null, environments: [], reason: undefined,
    });
  });

  it('requires a reason before granting Production, and disables confirm until one is entered', async () => {
    render(<GrantAccessDialog open user={user} onGranted={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByText('Acme');

    await userEvent.click(screen.getByLabelText(/Production/i));
    expect(screen.getByRole('button', { name: /grant access/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/reason/i), 'incident response');
    expect(screen.getByRole('button', { name: /grant access/i })).not.toBeDisabled();
  });

  it('narrows to a specific project once a client is chosen', async () => {
    render(<GrantAccessDialog open user={user} onGranted={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByText('Acme');

    await userEvent.selectOptions(screen.getByLabelText(/^client$/i), 'c1');
    expect(await screen.findByText('Website')).toBeInTheDocument();
  });
});
```

```jsx
// frontend/shared/components/access/__tests__/access-profile-drawer.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccessProfileDrawer from '../access-profile-drawer.jsx';

const listAccessAssignments = vi.fn();
const revokeAccess = vi.fn();

vi.mock('@/shared/api/access.js', () => ({
  listAccessAssignments: (...a) => listAccessAssignments(...a),
  revokeAccess: (...a) => revokeAccess(...a),
}));
vi.mock('@/shared/lib/toast.js', () => ({ showToast: vi.fn() }));

const user = { id: 'u1', name: 'Khushi', email: 'khushi@example.com' };

describe('AccessProfileDrawer', () => {
  beforeEach(() => {
    listAccessAssignments.mockReset().mockResolvedValue({
      results: [{
        id: 'a1', role: 'qa', status: 'active', environments: ['Staging'],
        client: { id: 'c1', name: 'Acme' }, project: null,
      }],
    });
    revokeAccess.mockReset().mockResolvedValue({ id: 'a1', status: 'revoked' });
  });

  it('shows an existing assignment with its scope and environments', async () => {
    render(<AccessProfileDrawer open user={user} onClose={vi.fn()} onGrantNew={vi.fn()} />);
    expect(await screen.findByText('qa')).toBeInTheDocument();
    expect(screen.getByText('Acme — all projects')).toBeInTheDocument();
    expect(screen.getByText('Staging')).toBeInTheDocument();
  });

  it('revoking requires typing a reason first', async () => {
    render(<AccessProfileDrawer open user={user} onClose={vi.fn()} onGrantNew={vi.fn()} />);
    await screen.findByText('qa');

    await userEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    expect(screen.getByRole('button', { name: /confirm revoke/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/reason for revoking/i), 'no longer needed');
    await userEvent.click(screen.getByRole('button', { name: /confirm revoke/i }));

    expect(revokeAccess).toHaveBeenCalledWith('a1', { reason: 'no longer needed' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run "shared/components/access/__tests__/grant-access-dialog.test.jsx" "shared/components/access/__tests__/access-profile-drawer.test.jsx"`
Expected: FAIL — neither component exists.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/shared/components/access/grant-access-dialog.jsx
'use client';

import { useEffect, useState } from 'react';
import { ROLES, ENVIRONMENTS } from '@pms/shared';
import { grantAccess } from '@/shared/api/access.js';
import { listClients } from '@/shared/api/clients.js';
import { listProjects } from '@/shared/api/projects.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';

const EMPTY = { client: '', project: '', role: 'member', environments: [], reason: '' };

export default function GrantAccessDialog({ open, user, onGranted, onCancel }) {
  const [form, setForm] = useState(EMPTY);
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY);
    setError(null);
    listClients({ status: 'active' }).then((page) => setClients(page.results)).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!form.client) { setProjects([]); return; }
    listProjects().then((page) => {
      setProjects(page.results.filter((p) => p.client === form.client));
    }).catch(() => {});
  }, [form.client]);

  if (!open) return null;

  function toggleEnvironment(env) {
    setForm((prev) => ({
      ...prev,
      environments: prev.environments.includes(env)
        ? prev.environments.filter((e) => e !== env)
        : [...prev.environments, env],
    }));
  }

  const needsReason = form.environments.includes('Production');

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const created = await grantAccess({
        user: user.id,
        role: form.role,
        client: form.client || null,
        project: form.project || null,
        environments: form.environments,
        reason: form.reason || undefined,
      });
      onGranted(created);
    } catch (err) {
      setError(normalizeApiError(err)?.message || 'Could not grant access');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" role="dialog" aria-label={`Grant access to ${user.name || user.email}`}>
      <div className="modal">
        <h2>Grant access</h2>
        <p className="sub">{user.name || user.email}</p>

        <label>
          Client
          <select
            value={form.client}
            onChange={(e) => setForm({ ...form, client: e.target.value, project: '' })}
          >
            <option value="">All clients (global)</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <label>
          Project
          <select
            value={form.project}
            onChange={(e) => setForm({ ...form, project: e.target.value })}
            disabled={!form.client}
          >
            <option value="">All projects under this client</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>

        <label>
          Role
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>

        <fieldset>
          <legend>Environments</legend>
          {ENVIRONMENTS.map((env) => (
            <label key={env} className="checkbox-row">
              <input
                type="checkbox"
                checked={form.environments.includes(env)}
                onChange={() => toggleEnvironment(env)}
              />
              {env}
              {env === 'Production' && <span className="chip chip--warning">Sensitive</span>}
            </label>
          ))}
        </fieldset>

        <label>
          Reason {needsReason && <span className="required">(required for Production)</span>}
          <textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </label>

        <p className="sub">
          Summary: <strong>{form.role}</strong> on{' '}
          <strong>{clients.find((c) => c.id === form.client)?.name || 'all clients'}</strong>
          {form.project && <> / <strong>{projects.find((p) => p.id === form.project)?.name}</strong></>}
          {' — '}
          {form.environments.length ? form.environments.join(', ') : 'no ticket/environment access'}
        </p>

        {error && <p className="row-action-status row-action-status--error">{error}</p>}

        <div className="row-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={confirm}
            disabled={busy || (needsReason && !form.reason.trim())}
          >
            {busy ? 'Granting…' : 'Grant access'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

```jsx
// frontend/shared/components/access/access-profile-drawer.jsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { listAccessAssignments, revokeAccess } from '@/shared/api/access.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';

function describeScope(assignment) {
  if (!assignment.client) return 'All clients';
  const clientName = assignment.client.name || 'Unknown client';
  if (!assignment.project) return `${clientName} — all projects`;
  return `${clientName} / ${assignment.project.name || 'Unknown project'}`;
}

export default function AccessProfileDrawer({ open, user, onClose, onGrantNew }) {
  const [assignments, setAssignments] = useState([]);
  const [error, setError] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [reason, setReason] = useState('');

  const reload = useCallback(() => {
    if (!user) return;
    listAccessAssignments({ userId: user.id }).then((page) => setAssignments(page.results)).catch(setError);
  }, [user]);

  useEffect(() => { if (open) reload(); }, [open, reload]);

  if (!open || !user) return null;

  async function confirmRevoke(assignment) {
    if (!reason.trim()) return;
    try {
      await revokeAccess(assignment.id, { reason: reason.trim() });
      showToast('Access revoked');
      setRevoking(null);
      setReason('');
      reload();
    } catch (err) {
      showToast(normalizeApiError(err)?.message || 'Could not revoke access');
    }
  }

  return (
    <div className="drawer" role="dialog" aria-label={`Access for ${user.name || user.email}`}>
      <h2>{user.name || user.email}</h2>
      <div className="row-actions">
        <p className="sub">Access</p>
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-primary" onClick={onGrantNew}>Grant new access</button>
      </div>

      <ul className="access-list">
        {assignments.map((a) => (
          <li key={a.id}>
            <span className="chip">{a.role}</span>
            <span>{describeScope(a)}</span>
            <span className="chip">
              {a.environments.length ? a.environments.join(', ') : 'No ticket access'}
            </span>
            <span className={`chip${a.status !== 'active' ? ' chip--warning' : ''}`}>{a.status}</span>
            {a.status === 'active' && (
              revoking === a.id ? (
                <span className="row-actions">
                  <input
                    aria-label="Reason for revoking"
                    placeholder="Reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <button
                    type="button" className="btn btn-sm btn-danger"
                    disabled={!reason.trim()} onClick={() => confirmRevoke(a)}
                  >
                    Confirm revoke
                  </button>
                  <button
                    type="button" className="btn btn-sm"
                    onClick={() => { setRevoking(null); setReason(''); }}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => setRevoking(a.id)}>
                  Revoke
                </button>
              )
            )}
          </li>
        ))}
        {assignments.length === 0 && <li className="sub">No access granted yet.</li>}
      </ul>
      {error && <p className="row-action-status row-action-status--error">{String(normalizeApiError(error)?.message || error)}</p>}

      <button type="button" className="btn" onClick={onClose}>Close</button>
    </div>
  );
}
```

Modify `frontend/app/(app)/users/page.jsx` — add imports, state, handlers, a table column, and the two component renders (everything else in the 368-line file is unchanged):

```jsx
// add to the top-of-file imports:
import AccessProfileDrawer from '@/shared/components/access/access-profile-drawer.jsx';
import GrantAccessDialog from '@/shared/components/access/grant-access-dialog.jsx';

// add alongside the existing useState calls inside UsersPage():
  const [accessUser, setAccessUser] = useState(null);
  const [grantUser, setGrantUser] = useState(null);

// add alongside the existing handler functions:
  function openGrantFromDrawer() {
    setGrantUser(accessUser);
    setAccessUser(null); // close the drawer while the grant dialog is open
  }

  function handleGranted() {
    const grantedFor = grantUser;
    setGrantUser(null);
    showToast('Access granted');
    setAccessUser(grantedFor); // reopening re-triggers the drawer's fetch (open: false -> true)
  }

// add one <th>/<td> pair to the existing table (Person / Email / Role / Status / [existing blank] / this new one):
//   <th>Access</th>  — add after the existing <th /> in <thead>
//   in the row, alongside the existing row-actions <td>:
                  <td>
                    <button type="button" className="btn btn-sm" onClick={() => setAccessUser(user)}>
                      Manage access
                    </button>
                  </td>

// add just before the closing </> of the returned JSX, alongside the existing dialogs:
      <AccessProfileDrawer
        open={Boolean(accessUser)}
        user={accessUser}
        onClose={() => setAccessUser(null)}
        onGrantNew={openGrantFromDrawer}
      />
      <GrantAccessDialog
        open={Boolean(grantUser)}
        user={grantUser}
        onGranted={handleGranted}
        onCancel={() => setGrantUser(null)}
      />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run "shared/components/access/__tests__/*.test.jsx" "app/\(app\)/users/__tests__/users.test.jsx"`
Expected: PASS, all cases in the two new files, and the pre-existing `users.test.jsx` unaffected (its mocks only cover `@/shared/api/users.js`, which this task didn't touch).

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/components/access/ frontend/app/\(app\)/users/page.jsx
git commit -m "feat(frontend): add Access Profile drawer and Grant Access dialog to the Users page"
```

---

## Task 21: Audit Log page

**Files:**
- Create: `frontend/app/(app)/audit-log/page.jsx`
- Create: `frontend/app/(app)/audit-log/__tests__/audit-log.test.jsx`
- Modify: `frontend/shared/components/app-sidebar.jsx`

**Interfaces:**
- Consumes: `listAuditLog` (Task 18).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/app/(app)/audit-log/__tests__/audit-log.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuditLogPage from '../page.jsx';

const listAuditLog = vi.fn();
vi.mock('@/shared/api/audit.js', () => ({ listAuditLog: (...a) => listAuditLog(...a) }));

describe('AuditLogPage', () => {
  beforeEach(() => {
    listAuditLog.mockReset().mockResolvedValue({
      results: [{
        id: 'e1', action: 'ACCESS_GRANTED', targetType: 'AccessAssignment', targetId: 'a1',
        actor: { id: 'u1', name: 'Prakhar' }, reason: 'QA access', createdAt: '2026-08-17T10:00:00.000Z',
      }],
      page: 1, totalPages: 1,
    });
  });

  it('lists audit entries with actor, action, and reason', async () => {
    render(<AuditLogPage />);
    expect(await screen.findByText('Prakhar')).toBeInTheDocument();
    expect(screen.getByText('ACCESS_GRANTED')).toBeInTheDocument();
    expect(screen.getByText('QA access')).toBeInTheDocument();
  });

  it('filtering by action re-queries with the selected action and resets to page 1', async () => {
    render(<AuditLogPage />);
    await screen.findByText('Prakhar');

    await userEvent.selectOptions(screen.getByLabelText(/filter by action/i), 'CLIENT_CREATED');

    expect(listAuditLog).toHaveBeenLastCalledWith({ action: 'CLIENT_CREATED', page: 1 });
  });

  it('shows an empty-state row when there are no entries', async () => {
    listAuditLog.mockResolvedValue({ results: [], page: 1, totalPages: 1 });
    render(<AuditLogPage />);
    expect(await screen.findByText(/no matching entries/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run "app/\(app\)/audit-log/__tests__/audit-log.test.jsx"`
Expected: FAIL — `../page.jsx` does not exist.

- [ ] **Step 3: Write minimal implementation**

```jsx
// frontend/app/(app)/audit-log/page.jsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { listAuditLog } from '@/shared/api/audit.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';

const ACTIONS = [
  'ACCESS_GRANTED', 'ACCESS_MODIFIED', 'ACCESS_SUSPENDED', 'ACCESS_REACTIVATED', 'ACCESS_REVOKED',
  'CLIENT_CREATED', 'CLIENT_UPDATED', 'CLIENT_ARCHIVED', 'CLIENT_REACTIVATED',
  'USER_SUSPENDED', 'USER_REACTIVATED',
];

export default function AuditLogPage() {
  const [entries, setEntries] = useState([]);
  const [action, setAction] = useState('');
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const reload = useCallback(() => {
    listAuditLog({ action: action || undefined, page })
      .then((result) => {
        setEntries(result.results);
        setTotalPages(result.totalPages);
      })
      .catch((err) => setError(normalizeApiError(err)?.message || 'Could not load the audit log'));
  }, [action, page]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="sub">Every access and client change, who made it, and why.</p>
        </div>
        <span className="spacer" />
      </div>

      <div className="row-actions">
        <select
          aria-label="Filter by action"
          value={action}
          onChange={(e) => { setPage(1); setAction(e.target.value); }}
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      {error && <p className="row-action-status row-action-status--error">{error}</p>}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{new Date(entry.createdAt).toLocaleString()}</td>
                <td>{entry.actor?.name || entry.actor?.email || String(entry.actor)}</td>
                <td><span className="chip">{entry.action}</span></td>
                <td>{entry.targetType} {entry.targetId}</td>
                <td>{entry.reason || '—'}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr><td colSpan={5} className="sub">No matching entries.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="row-actions">
        <button
          type="button" className="btn btn-sm"
          disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span className="sub">Page {page} of {totalPages || 1}</span>
        <button
          type="button" className="btn btn-sm"
          disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </>
  );
}
```

Modify `frontend/shared/components/app-sidebar.jsx` — add one more item to the `Admin` group (after the `/clients` entry added in Task 19):

```js
      { href: '/audit-log', id: 'audit-log', label: 'Audit log', icon: 'sliders', roles: ['admin'] },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run "app/\(app\)/audit-log/__tests__/audit-log.test.jsx"`
Expected: PASS, all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/\(app\)/audit-log/page.jsx frontend/app/\(app\)/audit-log/__tests__/audit-log.test.jsx frontend/shared/components/app-sidebar.jsx
git commit -m "feat(frontend): add Audit Log page"
```

---

## Task 22: Close the GET-by-id scoping gap; full-suite regression; final invariant checklist

**The gap, found by applying the spec's own testing requirement to what Tasks 9/16 actually built:** Task 16 scoped `listProjects` (a user only sees projects in their `effectiveScope`), but `getProject(id)` — the direct-by-id fetch — was left unscoped, exactly like `getTeam`. Same for Task 9's `getClient(id)`. That means a user could bypass list-level scoping entirely by guessing or otherwise obtaining an id and calling `GET /v1/projects/:id` / `GET /v1/clients/:id` directly — precisely the "enumerate by changing an id" gap flagged in the design spec's adversarial review. `Team` is deliberately left as-is: the approved spec decoupled Team from the authorization model entirely (a Team is a work-management construct, not a scope boundary), so its unscoped GET is intentional, not an oversight — only `Client` and `Project`, the actual scoping hierarchy, get fixed here.

**Files:**
- Modify: `backend/src/modules/clients/client.service.js`
- Modify: `backend/src/modules/clients/client.controller.js`
- Modify: `backend/src/modules/clients/__tests__/client.service.test.js` (the one existing assertion whose call signature changes)
- Modify: `backend/src/modules/projects/project.service.js`
- Modify: `backend/src/modules/projects/project.controller.js`
- Create: `backend/src/modules/clients/__tests__/client.access.test.js`
- Create: `backend/src/modules/projects/__tests__/project.getById.access.test.js`

**Interfaces:**
- `getClient(id)` → `getClient(actor, id)`; `getProject(id)` → `getProject(actor, id)` — both breaking signature changes, each with exactly one existing call site (their respective controllers), fixed in this task.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/modules/clients/__tests__/client.access.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import Client from '../client.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import { getClient } from '../client.service.js';

withMemoryDb();

const actor = () => ({ _id: new mongoose.Types.ObjectId(), status: 'active' });

test('a user scoped to client A cannot fetch client B directly by id', async () => {
  const who = actor();
  const clientA = await Client.create({ name: 'Acme', createdBy: who._id });
  const clientB = await Client.create({ name: 'Globex', createdBy: who._id });
  await AccessAssignment.create({
    user: who._id, role: 'member', client: clientA._id, grantedBy: who._id,
  });

  await getClient(who, clientA.id); // does not throw
  await assert.rejects(() => getClient(who, clientB.id), (err) => err.statusCode === 403);
});

test('a global-scope user can fetch any client', async () => {
  const who = actor();
  const client = await Client.create({ name: 'Acme', createdBy: who._id });
  await AccessAssignment.create({ user: who._id, role: 'admin', grantedBy: who._id });

  const found = await getClient(who, client.id);
  assert.equal(found.name, 'Acme');
});
```

```js
// backend/src/modules/projects/__tests__/project.getById.access.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import Client from '../../clients/client.model.js';
import Project from '../project.model.js';
import AccessAssignment from '../../access/accessAssignment.model.js';
import { getProject } from '../project.service.js';

withMemoryDb();

const actor = () => ({ _id: new mongoose.Types.ObjectId(), status: 'active' });

test('a user scoped to client A cannot fetch a client-B project directly by id', async () => {
  const who = actor();
  const clientA = await Client.create({ name: 'Acme', createdBy: who._id });
  const clientB = await Client.create({ name: 'Globex', createdBy: who._id });
  const projectB = await Project.create({
    key: 'ERP', name: 'ERP', client: clientB._id, createdBy: who._id,
  });
  await AccessAssignment.create({
    user: who._id, role: 'member', client: clientA._id, grantedBy: who._id,
  });

  await assert.rejects(() => getProject(who, projectB.id), (err) => err.statusCode === 403);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test backend/src/modules/clients/__tests__/client.access.test.js backend/src/modules/projects/__tests__/project.getById.access.test.js`
Expected: FAIL — `getClient`/`getProject` don't accept an actor yet and never reject.

- [ ] **Step 3: Write minimal implementation**

Modify `backend/src/modules/clients/client.service.js` — import `can` and change `getClient`:

```js
import { can, effectiveScope } from '../../platform/authorize.js';
// ... other existing imports unchanged ...

export async function getClient(actor, id) {
  const client = await Client.findById(id);
  if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Client not found');

  const allowed = await can(actor, 'clients.view', { clientId: client._id });
  if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'You cannot view this client');

  return client.toJSON();
}
```

Modify `backend/src/modules/clients/client.controller.js`:

```js
export const get = catchAsync(async (req, res) => {
  res.json(await clientService.getClient(req.user, req.params.id));
});
```

Modify `backend/src/modules/clients/__tests__/client.service.test.js` — the one existing call site:

```js
test('getClient throws 404 for a missing client', async () => {
  await assert.rejects(
    () => getClient({ _id: new mongoose.Types.ObjectId(), status: 'active' }, new mongoose.Types.ObjectId()),
    (err) => err.statusCode === 404,
  );
});
```

Modify `backend/src/modules/projects/project.service.js` — add `can` to the existing `authorize.js` import and change `getProject`:

```js
import { can, effectiveScope } from '../../platform/authorize.js';
// ... other existing imports unchanged ...

export async function getProject(actor, id) {
  const project = await Project.findById(id)
    .populate(['defaultAssignee', 'defaultTester', 'defaultTeam']);
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');

  const allowed = await can(actor, 'projects.view', { projectId: project._id });
  if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'You cannot view this project');

  return project.toJSON();
}
```

Modify `backend/src/modules/projects/project.controller.js`:

```js
export const get = catchAsync(async (req, res) => {
  res.json(await projectService.getProject(req.user, req.params.id));
});
```

- [ ] **Step 4: Run test to verify it passes**

Run the two new files, then the full backend suite, then the full frontend suite:

```bash
node --test backend/src/modules/clients/__tests__/client.access.test.js backend/src/modules/projects/__tests__/project.getById.access.test.js
cd backend && npm test
cd ../frontend && npx vitest run
```

Expected: everything green. This is the first time in the plan every test file runs together — if anything from Tasks 1-21 was missed (a fixture needing an `AccessAssignment` that got skipped, an import path typo), it surfaces here.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/clients/client.service.js backend/src/modules/clients/client.controller.js backend/src/modules/clients/__tests__/client.service.test.js backend/src/modules/clients/__tests__/client.access.test.js backend/src/modules/projects/project.service.js backend/src/modules/projects/project.controller.js backend/src/modules/projects/__tests__/project.getById.access.test.js
git commit -m "fix(access): scope Client/Project GET-by-id to the caller's access, closing the id-enumeration gap"
```

### Final checklist against the design spec

Each item names the test(s) that satisfy it — this is verification, not more code:

- **Default deny** (§6.1): `authorize.can.test.js` — "a global admin assignment with empty environments cannot view tickets."
- **Server-side authorization on every endpoint** (§6.2): every route in Tasks 9-17 goes through `requirePermission`/`canDelegate`/`can`; none rely on frontend hiding.
- **Client isolation, including by-id enumeration** (§6.3, §6.4): `ticket.access.test.js`, `client.access.test.js`, `project.getById.access.test.js`, `accessAssignment.routes.test.js`'s cross-client 403 case.
- **Environment restrictions, empty ≠ all** (§6.5, §6.18): `authorize.can.test.js`'s empty-environments cases.
- **Suspended/expired grant nothing** (§6.6, §6.7): `authorize.can.test.js`.
- **Delegation scope/permission containment, no escalation** (§6.8, §6.9, §6.10, §6.11): `authorize.canDelegate.test.js`'s six boundary cases.
- **Last global admin cannot be removed, concurrency-safe** (§6.12): `globalAdminGuard.test.js`'s concurrent-decrement case, `accessAssignment.service.test.js`, `user.service.lastAdmin.test.js`.
- **Audit log append-only** (§6.13): no update/delete function exists anywhere in `accessAssignment.service.js`/`client.service.js`/`auditLog.service.js` — structural, not tested by assertion.
- **Archived scope blocks mutation, not view** (§6.16): `authorize.can.test.js`'s archived-scope case.
- **Fail-closed on error** (§6.19): `authorize.can.test.js`'s inactive-user and thrown-on-missing-environment cases.
- **Migration is idempotent and reversible in two stages** (§10): `migration.test.js`'s run-twice case; the data-creation/enforcement-cutover split is structural (Tasks 14 and 15-17 are separate commits).
- **Rate limiting on the control plane** (§7): `accessMutationLimiter`, wired in Task 11 (not independently tested — this codebase has no existing precedent of testing a rate limiter's threshold directly; the existing `loginLimiter` etc. aren't either).

Anything in this list that fails on re-inspection is a real bug — fix it before considering Phase 1 done, not after.

