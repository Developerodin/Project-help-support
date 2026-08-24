import {
  ENVIRONMENTS,
  ROLE_IDS,
  hasAnyRole,
  isSuperAdmin,
  validateDelegation,
  SCOPED_ASSIGNABLE_ROLES,
} from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import User from '../users/user.model.js';
import Client from '../clients/client.model.js';
import Project from '../projects/project.model.js';
import AccessAssignment from './accessAssignment.model.js';
import {
  activeNotExpiredFilter,
  revokeExpiredActiveDuplicates,
} from './accessAssignment.queries.js';
import {
  assertExternalRoleTarget,
  isExternalRole,
  propagateCompanyWideClientTesterGrant,
  propagateCompanyWideClientTesterRevoke,
} from './external-auth.service.js';
import { recordRbacAudit } from '../rbac/rbac-audit.js';

const GLOBAL_SCOPE_MANAGERS = [ROLE_IDS.SUPER_ADMIN, ROLE_IDS.ADMIN];

function serialiseAssignment(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  return {
    id: json.id ?? (json._id ? String(json._id) : undefined),
    userId: json.user,
    role: json.role,
    clientId: json.client ?? null,
    projectId: json.project ?? null,
    environments: json.environments || [],
    status: json.status,
    expiresAt: json.expiresAt ?? null,
    grantedBy: json.grantedBy,
    reason: json.reason ?? null,
    createdAt: json.createdAt ?? null,
    updatedAt: json.updatedAt ?? null,
  };
}

function assertCanManageScopedAccess(actor) {
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  if (!hasAnyRole(actor, ...GLOBAL_SCOPE_MANAGERS) && !hasAnyRole(actor, ROLE_IDS.PROJECT_ADMIN)) {
    throw new ApiError(403, 'FORBIDDEN', 'Requires access management privileges');
  }
}

function assertTargetUserVisible(actor, target) {
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  if (isSuperAdmin(target) && !isSuperAdmin(actor)) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
}

async function assertScopeEntities({ clientId, projectId }) {
  if (projectId && !clientId) {
    throw new ApiError(400, 'CLIENT_REQUIRED', 'A project-scoped assignment requires a client');
  }

  if (clientId) {
    const client = await Client.findById(clientId).select('status').lean();
    if (!client || client.status !== 'active') {
      throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Client not found');
    }
  }

  if (projectId) {
    const project = await Project.findById(projectId).select('client status').lean();
    if (!project || project.status !== 'active') {
      throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    if (clientId && String(project.client) !== String(clientId)) {
      throw new ApiError(400, 'PROJECT_CLIENT_MISMATCH', 'Project does not belong to the specified client');
    }
  }
}

async function actorCoversScope(actor, { clientId, projectId }) {
  if (hasAnyRole(actor, ...GLOBAL_SCOPE_MANAGERS)) return true;
  if (!hasAnyRole(actor, ROLE_IDS.PROJECT_ADMIN)) return false;
  if (!clientId && !projectId) {
    throw new ApiError(403, 'FORBIDDEN', 'Project Admins may only manage scoped assignments within their coverage');
  }

  const actorAssignments = await AccessAssignment.find(activeNotExpiredFilter({
    user: actor._id,
    role: ROLE_IDS.PROJECT_ADMIN,
  })).select('client project').lean();

  let needsProjectClientCheck = false;
  for (const row of actorAssignments) {
    if (projectId && row.project && String(row.project) === String(projectId)) return true;
    if (!row.project && row.client && clientId && String(row.client) === String(clientId)) {
      if (!projectId) return true;
      needsProjectClientCheck = true;
    }
  }

  if (needsProjectClientCheck && projectId) {
    const project = await Project.findById(projectId).select('client').lean();
    if (project) {
      for (const row of actorAssignments) {
        if (!row.project && row.client && String(project.client) === String(row.client)) {
          return true;
        }
      }
    }
  }

  return false;
}

async function assignmentVisibleToActor(actor, assignment) {
  if (hasAnyRole(actor, ...GLOBAL_SCOPE_MANAGERS)) return true;
  if (!hasAnyRole(actor, ROLE_IDS.PROJECT_ADMIN)) return false;

  const clientId = assignment.clientId ?? assignment.client ?? null;
  const projectId = assignment.projectId ?? assignment.project ?? null;
  if (!clientId && !projectId) return false;

  try {
    return await actorCoversScope(actor, { clientId, projectId });
  } catch {
    return false;
  }
}

async function assertActorScopeAuthority(actor, scope) {
  if (await actorCoversScope(actor, scope)) return;
  throw new ApiError(403, 'FORBIDDEN', 'You do not have authority over this client/project scope');
}

async function assertActorScopeAuthorityOnBoth(actor, existingScope, nextScope) {
  await assertActorScopeAuthority(actor, existingScope);
  await assertActorScopeAuthority(actor, nextScope);
}

async function filterAssignmentsVisibleToActor(actor, assignments) {
  const visible = [];
  for (const assignment of assignments) {
    if (await assignmentVisibleToActor(actor, assignment)) visible.push(assignment);
  }
  return visible;
}

function assertDelegation(actor, targetRole, targetUserId) {
  const result = validateDelegation(actor, targetRole, { targetUserId });
  if (result.allowed) return;
  const messages = {
    CANNOT_DELEGATE_SELF: 'You cannot change your own scoped access',
    ROLE_NOT_DELEGATABLE: 'This role cannot be granted through scoped assignments',
    INSUFFICIENT_DELEGATION_RANK: 'You cannot grant or modify a role senior to your own',
  };
  throw new ApiError(403, result.code, messages[result.code] || 'Delegation not permitted');
}

function normaliseEnvironments(values) {
  if (!values) return [];
  const unique = [...new Set(values)];
  for (const env of unique) {
    if (!ENVIRONMENTS.includes(env)) {
      throw new ApiError(400, 'INVALID_ENVIRONMENT', `Unknown environment: ${env}`);
    }
  }
  return unique;
}

function assertReasonRequired({ status, environments, reason }) {
  const sensitive = status !== 'active' || (environments || []).includes('Production');
  if (sensitive && !String(reason || '').trim()) {
    throw new ApiError(
      400,
      'REASON_REQUIRED',
      'A reason is required when revoking, suspending, or granting Production access',
    );
  }
}

function buildAssignmentConflictError() {
  return new ApiError(
    409,
    'ASSIGNMENT_CONFLICT',
    'Assignment was modified by another request. Reload and retry with the latest updatedAt.',
  );
}

function parseIfMatchTimestamp(ifMatch) {
  const expected = new Date(ifMatch);
  if (Number.isNaN(expected.getTime())) return null;
  return expected;
}

async function saveAssignmentWithOptionalIfMatch(assignmentId, ifMatch, setFields) {
  if (ifMatch) {
    const expectedUpdatedAt = parseIfMatchTimestamp(ifMatch);
    if (!expectedUpdatedAt) throw buildAssignmentConflictError();

    try {
      const updated = await AccessAssignment.findOneAndUpdate(
        { _id: assignmentId, updatedAt: expectedUpdatedAt },
        { $set: setFields },
        { new: true, runValidators: true },
      );
      if (!updated) throw buildAssignmentConflictError();
      return updated;
    } catch (err) {
      if (err?.code === 11000) {
        throw new ApiError(
          409,
          'ASSIGNMENT_EXISTS',
          'An active assignment already exists for this user, role, and scope',
        );
      }
      throw err;
    }
  }

  const doc = await AccessAssignment.findById(assignmentId);
  if (!doc) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Scoped assignment not found');

  for (const [key, value] of Object.entries(setFields)) {
    doc[key] = value;
  }

  try {
    await doc.save();
  } catch (err) {
    if (err?.code === 11000) {
      throw new ApiError(
        409,
        'ASSIGNMENT_EXISTS',
        'An active assignment already exists for this user, role, and scope',
      );
    }
    throw err;
  }
  return doc;
}

async function auditScopedAccessChange(actor, action, details) {
  await recordRbacAudit(actor, action, details);
}

export async function loadScopedAssignmentsForUser(userId, { status = 'active', effectivelyActive = true } = {}) {
  if (status === 'active' && effectivelyActive) {
    const rows = await AccessAssignment.find(activeNotExpiredFilter({ user: userId }))
      .sort({ updatedAt: -1 })
      .lean();
    return rows.map((row) => serialiseAssignment(row));
  }

  const filter = { user: userId };
  if (status) filter.status = status;
  const rows = await AccessAssignment.find(filter).sort({ updatedAt: -1 }).lean();
  return rows.map((row) => serialiseAssignment(row));
}

export async function listUserScopedAssignments(actor, userId) {
  assertCanManageScopedAccess(actor);
  const user = await User.findById(userId);
  assertTargetUserVisible(actor, user);

  const assignments = await loadScopedAssignmentsForUser(userId, { status: null });
  const visibleAssignments = await filterAssignmentsVisibleToActor(actor, assignments);
  return {
    userId: user.toJSON().id,
    assignments: visibleAssignments,
  };
}

export async function createScopedAssignment(actor, userId, body) {
  assertCanManageScopedAccess(actor);
  assertDelegation(actor, body.role, userId);

  const user = await User.findById(userId);
  assertTargetUserVisible(actor, user);
  if (user.status !== 'active') {
    throw new ApiError(400, 'USER_NOT_ACTIVE', 'Only active users can receive scoped assignments');
  }

  const clientId = body.clientId ?? null;
  const projectId = body.projectId ?? null;
  const environments = normaliseEnvironments(body.environments);
  const status = body.status || 'active';

  if (!SCOPED_ASSIGNABLE_ROLES.includes(body.role)) {
    throw new ApiError(400, 'INVALID_ROLE', 'Role is not assignable in scoped access');
  }

  if (isExternalRole(body.role) && !clientId) {
    throw new ApiError(400, 'CLIENT_REQUIRED', 'External roles require a company scope');
  }

  await assertScopeEntities({ clientId, projectId });
  await assertActorScopeAuthority(actor, { clientId, projectId });
  assertReasonRequired({ status, environments, reason: body.reason });
  await assertExternalRoleTarget(user, body.role);

  await revokeExpiredActiveDuplicates({
    userId,
    role: body.role,
    clientId,
    projectId,
  });

  try {
    const doc = await AccessAssignment.create({
      user: userId,
      role: body.role,
      client: clientId,
      project: projectId,
      environments,
      status,
      expiresAt: body.expiresAt ?? null,
      grantedBy: actor._id,
      reason: body.reason?.trim() || null,
    });

    await auditScopedAccessChange(actor, 'scoped_assignment.create', {
      assignmentId: String(doc._id),
      userId: String(userId),
      role: body.role,
      clientId,
      projectId,
    });

    if (body.role === ROLE_IDS.CLIENT_TESTER && clientId && !projectId) {
      await propagateCompanyWideClientTesterGrant(actor, clientId, userId);
    }

    return serialiseAssignment(doc);
  } catch (err) {
    if (err?.code === 11000) {
      throw new ApiError(
        409,
        'ASSIGNMENT_EXISTS',
        'An active assignment already exists for this user, role, and scope',
      );
    }
    throw err;
  }
}

export async function updateScopedAssignment(actor, assignmentId, body) {
  assertCanManageScopedAccess(actor);

  const existing = await AccessAssignment.findById(assignmentId);
  if (!existing) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Scoped assignment not found');

  const targetUserId = String(existing.user);
  const nextRole = body.role ?? existing.role;
  assertDelegation(actor, nextRole, targetUserId);

  const user = await User.findById(existing.user);
  assertTargetUserVisible(actor, user);
  await assertExternalRoleTarget(user, nextRole);

  const clientId = body.clientId !== undefined ? body.clientId : existing.client;
  const projectId = body.projectId !== undefined ? body.projectId : existing.project;
  const environments = body.environments !== undefined
    ? normaliseEnvironments(body.environments)
    : existing.environments;
  const status = body.status ?? existing.status;

  if (body.role && !SCOPED_ASSIGNABLE_ROLES.includes(body.role)) {
    throw new ApiError(400, 'INVALID_ROLE', 'Role is not assignable in scoped access');
  }

  await assertScopeEntities({ clientId, projectId });
  await assertActorScopeAuthorityOnBoth(
    actor,
    { clientId: existing.client, projectId: existing.project },
    { clientId, projectId },
  );
  assertReasonRequired({ status, environments, reason: body.reason ?? existing.reason });

  const previous = serialiseAssignment(existing);

  const setFields = {};
  if (body.role !== undefined) setFields.role = body.role;
  if (body.clientId !== undefined) setFields.client = body.clientId;
  if (body.projectId !== undefined) setFields.project = body.projectId;
  if (body.environments !== undefined) setFields.environments = environments;
  if (body.status !== undefined) setFields.status = body.status;
  if (body.expiresAt !== undefined) setFields.expiresAt = body.expiresAt;
  if (body.reason !== undefined) setFields.reason = body.reason?.trim() || null;

  const doc = await saveAssignmentWithOptionalIfMatch(assignmentId, body.ifMatch, setFields);

  await auditScopedAccessChange(actor, 'scoped_assignment.update', {
    assignmentId: String(doc._id),
    previous,
    next: serialiseAssignment(doc),
  });

  return serialiseAssignment(doc);
}

export async function revokeScopedAssignment(actor, assignmentId, body = {}) {
  assertCanManageScopedAccess(actor);

  const existing = await AccessAssignment.findById(assignmentId);
  if (!existing) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Scoped assignment not found');

  assertDelegation(actor, existing.role, existing.user);
  await assertActorScopeAuthority(actor, {
    clientId: existing.client,
    projectId: existing.project,
  });
  assertReasonRequired({
    status: 'revoked',
    environments: existing.environments,
    reason: body.reason,
  });

  const previous = serialiseAssignment(existing);
  const reason = body.reason.trim();

  const doc = await saveAssignmentWithOptionalIfMatch(assignmentId, body.ifMatch, {
    status: 'revoked',
    reason,
  });

  await auditScopedAccessChange(actor, 'scoped_assignment.revoke', {
    assignmentId: String(doc._id),
    previous,
    next: serialiseAssignment(doc),
  });

  if (
    existing.role === ROLE_IDS.CLIENT_TESTER
    && existing.client
    && !existing.project
  ) {
    await propagateCompanyWideClientTesterRevoke(existing.client, existing.user);
  }

  return serialiseAssignment(doc);
}
