import {
  ROLE_IDS,
  ROLE_PERMISSIONS,
  isSuperAdmin,
  hasAnyRole,
  ADMIN_ROLES,
  buildRoleMatrix,
  diffRoleMatrices,
  getEffectivePermissions,
  getRoleBaselinePermissions,
  mergeRoleMatrixWithBaseline,
  buildRoleCustomization,
  cloneStoredRoleCustomization,
  normaliseUserOverrides,
  recordToRoleMatrix,
  roleMatrixToRecord,
  OVERRIDE_EDITABLE_PERMISSIONS,
  resolvePermissionKey,
  canInScope,
  normaliseScopeTarget,
  buildBoardRolePolicy,
  boardPolicyToRecord,
  recordToBoardPolicy,
  diffBoardPolicies,
  DEFAULT_BOARD_ROLE_POLICY,
  MATRIX_ROLES,
} from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import User from '../users/user.model.js';
import { loadScopedAssignmentsForUser } from '../access/scoped-access.service.js';
import RoleMatrix from './roleMatrix.model.js';
import BoardRoleMatrix from './boardRoleMatrix.model.js';
import UserPermissionOverride from './userPermissionOverride.model.js';
import RbacAuditLog from './rbacAuditLog.model.js';
import { recordRbacAudit } from './rbac-audit.js';

export { canInScope, normaliseScopeTarget };

const MATRIX_KEY = 'active';
const BOARD_MATRIX_KEY = 'active';

function buildPolicyConflictError() {
  return new ApiError(
    409,
    'POLICY_CONFLICT',
    'Policy was modified by another request. Reload and retry with the latest updatedAt.',
  );
}

function parseIfMatchTimestamp(ifMatch) {
  const expected = new Date(ifMatch);
  if (Number.isNaN(expected.getTime())) return null;
  return expected;
}

function grantsMapToBoardPolicy(grantsMap) {
  const record = {};
  const source = grantsMap instanceof Map ? Object.fromEntries(grantsMap) : grantsMap;
  for (const [role, boards] of Object.entries(source || {})) {
    const boardRecord = boards instanceof Map ? Object.fromEntries(boards) : boards;
    record[role] = boardRecord;
  }
  return recordToBoardPolicy(record);
}

export function getCodeBaselineBoardPolicy() {
  return buildBoardRolePolicy(DEFAULT_BOARD_ROLE_POLICY);
}

async function loadStoredBoardPolicyRecord() {
  const doc = await BoardRoleMatrix.findOne({ key: BOARD_MATRIX_KEY });
  if (!doc) return null;
  return grantsMapToBoardPolicy(doc.grants);
}

export async function getEffectiveBoardRolePolicy() {
  const stored = await loadStoredBoardPolicyRecord();
  if (!stored) return buildBoardRolePolicy();
  return stored;
}

export async function getBoardPermissions(actor) {
  assertCanManageRbac(actor);
  const baseline = boardPolicyToRecord(getCodeBaselineBoardPolicy());
  const storedDoc = await BoardRoleMatrix.findOne({ key: BOARD_MATRIX_KEY });
  const effective = boardPolicyToRecord(await getEffectiveBoardRolePolicy());

  return {
    baseline,
    effective,
    customizations: storedDoc ? boardPolicyToRecord(grantsMapToBoardPolicy(storedDoc.grants)) : null,
    updatedAt: storedDoc?.updatedAt ?? null,
    updatedBy: storedDoc?.updatedBy ?? null,
  };
}

export async function updateBoardPermissions(actor, body) {
  assertCanManageRbac(actor);
  if (!body?.grants || typeof body.grants !== 'object') {
    throw new ApiError(400, 'GRANTS_REQUIRED', 'grants object is required');
  }

  const baselineRecord = boardPolicyToRecord(getCodeBaselineBoardPolicy());
  const previous = await loadStoredBoardPolicyRecord();
  const previousRecord = previous ? boardPolicyToRecord(previous) : baselineRecord;

  const mergedRecord = { ...previousRecord };
  for (const [role, boards] of Object.entries(body.grants)) {
    mergedRecord[role] = { ...(mergedRecord[role] || {}), ...boards };
  }

  const nextPolicy = recordToBoardPolicy(mergedRecord);
  const nextRecord = boardPolicyToRecord(nextPolicy);
  const changes = diffBoardPolicies(
    previous || getCodeBaselineBoardPolicy(),
    nextPolicy,
  );

  const grantsMap = new Map();
  for (const [role, boards] of Object.entries(nextRecord)) {
    grantsMap.set(role, new Map(Object.entries(boards)));
  }

  let doc;
  if (body.ifMatch) {
    const expectedUpdatedAt = parseIfMatchTimestamp(body.ifMatch);
    if (!expectedUpdatedAt) throw buildPolicyConflictError();
    doc = await BoardRoleMatrix.findOneAndUpdate(
      { key: BOARD_MATRIX_KEY, updatedAt: expectedUpdatedAt },
      { $set: { grants: grantsMap, updatedBy: actor._id } },
      { new: true, runValidators: true },
    );
    if (!doc) throw buildPolicyConflictError();
  } else {
    doc = await BoardRoleMatrix.findOneAndUpdate(
      { key: BOARD_MATRIX_KEY },
      { $set: { grants: grantsMap, updatedBy: actor._id }, $setOnInsert: { key: BOARD_MATRIX_KEY } },
      { upsert: true, new: true, runValidators: true },
    );
  }

  await auditRbacChange(actor, 'board_permissions.update', {
    changeCount: changes.length,
    changes,
    previous: previousRecord,
    next: nextRecord,
  });

  return {
    effective: nextRecord,
    customizations: nextRecord,
    updatedAt: doc.updatedAt,
    updatedBy: doc.updatedBy,
    changes,
  };
}

export async function resetBoardPermissions(actor) {
  assertCanManageRbac(actor);
  const existing = await BoardRoleMatrix.findOne({ key: BOARD_MATRIX_KEY });
  if (!existing) {
    return {
      effective: boardPolicyToRecord(getCodeBaselineBoardPolicy()),
      customizations: null,
      updatedAt: null,
      updatedBy: null,
      changes: [],
    };
  }

  const previous = boardPolicyToRecord(grantsMapToBoardPolicy(existing.grants));
  await BoardRoleMatrix.deleteOne({ key: BOARD_MATRIX_KEY });
  const baseline = boardPolicyToRecord(getCodeBaselineBoardPolicy());
  const changes = diffBoardPolicies(grantsMapToBoardPolicy(existing.grants), getCodeBaselineBoardPolicy());

  await auditRbacChange(actor, 'board_permissions.reset', { previous, next: baseline, changes });

  return {
    effective: baseline,
    customizations: null,
    updatedAt: null,
    updatedBy: null,
    changes,
  };
}

export async function getBoardPermissionsEffective(actor) {
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  return {
    effective: boardPolicyToRecord(await getEffectiveBoardRolePolicy()),
  };
}

export async function getRoleMatrixEffective(actor) {
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  return {
    effective: await getEffectiveRoleMatrixRecord(),
  };
}

function entriesToOverrides(entries = []) {
  const overrides = {};
  for (const entry of entries) {
    if (!entry?.permission || !entry?.state) continue;
    overrides[resolvePermissionKey(entry.permission)] = entry.state;
  }
  return overrides;
}

function overridesToEntries(overrides = {}) {
  return Object.entries(overrides).map(([permission, state]) => ({ permission, state }));
}

function grantsMapToStoredRecord(grantsMap) {
  const record = {};
  const source = grantsMap instanceof Map ? Object.fromEntries(grantsMap) : grantsMap;
  for (const [role, value] of Object.entries(source || {})) {
    if (!MATRIX_ROLES.includes(role)) continue;
    record[role] = cloneStoredRoleCustomization(value);
  }
  return record;
}

function storedRecordToMatrix(storedRecord) {
  return recordToRoleMatrix(mergeRoleMatrixWithBaseline(storedRecord || {}));
}

export function getCodeBaselineMatrix() {
  return buildRoleMatrix(ROLE_PERMISSIONS);
}

async function loadStoredMatrixRecord() {
  const doc = await RoleMatrix.findOne({ key: MATRIX_KEY });
  if (!doc) return null;
  return grantsMapToStoredRecord(doc.grants);
}

export async function getEffectiveRoleMatrixRecord() {
  const stored = await loadStoredMatrixRecord();
  if (!stored) return roleMatrixToRecord(getCodeBaselineMatrix());
  return mergeRoleMatrixWithBaseline(stored);
}

export async function loadPermissionContextForUser(userId) {
  const [roleMatrix, overrideDoc, scopedAssignments] = await Promise.all([
    loadStoredMatrixRecord(),
    UserPermissionOverride.findOne({ user: userId }),
    loadScopedAssignmentsForUser(userId, { effectivelyActive: false }),
  ]);

  return {
    roleMatrix: roleMatrix ? mergeRoleMatrixWithBaseline(roleMatrix) : null,
    userOverrides: entriesToOverrides(overrideDoc?.entries),
    scopedAssignments,
    loadFailed: false,
  };
}

/** Deny-by-default context when RBAC policy data cannot be loaded at auth time. */
export function createDenyByDefaultPermissionContext() {
  return {
    roleMatrix: null,
    userOverrides: {},
    scopedAssignments: [],
    loadFailed: true,
  };
}

/** Service-layer scoped permission check for routes and domain services. */
export function assertPermissionInScope(actor, permission, scopeTarget, permissionContext) {
  if (!canInScope(actor, permission, scopeTarget, permissionContext)) {
    throw new ApiError(403, 'FORBIDDEN', `Requires permission: ${permission} in scope`);
  }
}

function assertCanManageRbac(actor) {
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  if (!hasAnyRole(actor, ...ADMIN_ROLES)) {
    throw new ApiError(403, 'FORBIDDEN', 'Requires admin access to manage RBAC policy');
  }
}

function assertTargetUserVisible(actor, target) {
  if (!target) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  if (isSuperAdmin(target) && !isSuperAdmin(actor)) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  }
}

function assertCanEditTargetOverrides(actor, targetUserId) {
  if (String(actor._id) === String(targetUserId)) {
    throw new ApiError(400, 'CANNOT_OVERRIDE_SELF', 'You cannot change your own permission overrides');
  }
}

function assertMatrixSafety(matrixRecord) {
  for (const protectedRole of [ROLE_IDS.SUPER_ADMIN, ROLE_IDS.ADMIN]) {
    const grants = matrixRecord[protectedRole] || [];
    if (!grants.includes('users.manage') || !grants.includes('access.grant')) {
      throw new ApiError(
        400,
        'MATRIX_SAFETY_VIOLATION',
        `${protectedRole} must retain users.manage and access.grant`,
      );
    }
  }
}

async function auditRbacChange(actor, action, details) {
  await recordRbacAudit(actor, action, details);
}

function serialiseAuditRow(doc) {
  const json = doc.toJSON ? doc.toJSON() : doc;
  return {
    id: json.id,
    action: json.action,
    category: json.category,
    actor: json.actor,
    targetUser: json.targetUser ?? null,
    assignment: json.assignment ?? null,
    details: json.details ?? {},
    createdAt: json.createdAt,
  };
}

export async function getRoleMatrix(actor) {
  assertCanManageRbac(actor);
  const baseline = roleMatrixToRecord(getCodeBaselineMatrix());
  const storedDoc = await RoleMatrix.findOne({ key: MATRIX_KEY });
  const storedRecord = storedDoc ? grantsMapToStoredRecord(storedDoc.grants) : null;
  const effective = storedRecord
    ? mergeRoleMatrixWithBaseline(storedRecord)
    : baseline;

  return {
    baseline,
    effective,
    customizations: storedRecord,
    updatedAt: storedDoc?.updatedAt ?? null,
    updatedBy: storedDoc?.updatedBy ?? null,
  };
}

export async function updateRoleMatrix(actor, body) {
  assertCanManageRbac(actor);
  if (!body?.grants || typeof body.grants !== 'object') {
    throw new ApiError(400, 'GRANTS_REQUIRED', 'grants object is required');
  }

  const baselineRecord = roleMatrixToRecord(getCodeBaselineMatrix());
  const previousStored = await loadStoredMatrixRecord();
  const previousEffective = previousStored
    ? mergeRoleMatrixWithBaseline(previousStored)
    : baselineRecord;
  const previousMatrix = recordToRoleMatrix(previousEffective);

  const nextStored = { ...(previousStored || {}) };
  for (const [role, desired] of Object.entries(body.grants)) {
    if (!MATRIX_ROLES.includes(role)) continue;
    const customization = buildRoleCustomization(role, desired);
    if (customization == null) delete nextStored[role];
    else nextStored[role] = customization;
  }

  const nextEffective = mergeRoleMatrixWithBaseline(nextStored);
  const nextMatrix = recordToRoleMatrix(nextEffective);
  const nextRecord = nextEffective;
  assertMatrixSafety(nextRecord);
  const changes = diffRoleMatrices(previousMatrix, nextMatrix);

  const hasCustomizations = Object.keys(nextStored).length > 0;
  let doc = null;
  if (!hasCustomizations) {
    if (body.ifMatch) {
      const expectedUpdatedAt = parseIfMatchTimestamp(body.ifMatch);
      if (!expectedUpdatedAt) throw buildPolicyConflictError();
      const existing = await RoleMatrix.findOne({ key: MATRIX_KEY });
      if (existing) {
        doc = await RoleMatrix.findOneAndDelete({
          key: MATRIX_KEY,
          updatedAt: expectedUpdatedAt,
        });
        if (!doc) throw buildPolicyConflictError();
      }
    } else {
      await RoleMatrix.deleteOne({ key: MATRIX_KEY });
    }
  } else {
    const grantsMap = new Map(
      Object.entries(nextStored).map(([role, value]) => [role, cloneStoredRoleCustomization(value)]),
    );
    if (body.ifMatch) {
      const expectedUpdatedAt = parseIfMatchTimestamp(body.ifMatch);
      if (!expectedUpdatedAt) throw buildPolicyConflictError();
      doc = await RoleMatrix.findOneAndUpdate(
        { key: MATRIX_KEY, updatedAt: expectedUpdatedAt },
        { $set: { grants: grantsMap, updatedBy: actor._id } },
        { new: true, runValidators: true },
      );
      if (!doc) throw buildPolicyConflictError();
    } else {
      doc = await RoleMatrix.findOneAndUpdate(
        { key: MATRIX_KEY },
        { $set: { grants: grantsMap, updatedBy: actor._id }, $setOnInsert: { key: MATRIX_KEY } },
        { upsert: true, new: true, runValidators: true },
      );
    }
  }

  await auditRbacChange(actor, 'role_matrix.update', {
    changeCount: changes.length,
    changes,
    previous: previousEffective,
    next: nextRecord,
  });

  return {
    effective: nextRecord,
    customizations: hasCustomizations ? grantsMapToStoredRecord(doc.grants) : null,
    updatedAt: doc?.updatedAt ?? null,
    updatedBy: doc?.updatedBy ?? null,
    changes,
  };
}

export async function resetRoleMatrix(actor) {
  assertCanManageRbac(actor);
  const existing = await RoleMatrix.findOne({ key: MATRIX_KEY });
  if (!existing) {
    return {
      effective: roleMatrixToRecord(getCodeBaselineMatrix()),
      customizations: null,
      updatedAt: null,
      updatedBy: null,
      changes: [],
    };
  }

  const previous = grantsMapToStoredRecord(existing.grants);
  await RoleMatrix.deleteOne({ key: MATRIX_KEY });
  const baseline = roleMatrixToRecord(getCodeBaselineMatrix());
  const changes = diffRoleMatrices(storedRecordToMatrix(previous), getCodeBaselineMatrix());

  await auditRbacChange(actor, 'role_matrix.reset', { previous, next: baseline, changes });

  return {
    effective: baseline,
    customizations: null,
    updatedAt: null,
    updatedBy: null,
    changes,
  };
}

export async function getUserPermissionOverrides(actor, userId) {
  assertCanManageRbac(actor);
  const user = await User.findById(userId);
  assertTargetUserVisible(actor, user);

  const roleMatrix = await loadStoredMatrixRecord();
  const roleMatrixRecord = roleMatrix ? mergeRoleMatrixWithBaseline(roleMatrix) : null;
  const overrideDoc = await UserPermissionOverride.findOne({ user: userId });
  const overrides = entriesToOverrides(overrideDoc?.entries);

  const userJson = user.toJSON();
  return {
    userId: userJson.id,
    overrides,
    editablePermissions: [...OVERRIDE_EDITABLE_PERMISSIONS],
    baseline: [...getRoleBaselinePermissions(userJson, roleMatrixRecord)].sort(),
    effective: [...getEffectivePermissions(userJson, {
      roleMatrix: roleMatrixRecord,
      userOverrides: overrides,
    })].sort(),
    updatedAt: overrideDoc?.updatedAt ?? null,
    updatedBy: overrideDoc?.updatedBy ?? null,
  };
}

export async function updateUserPermissionOverrides(actor, userId, body) {
  assertCanManageRbac(actor);
  assertCanEditTargetOverrides(actor, userId);

  const user = await User.findById(userId);
  assertTargetUserVisible(actor, user);
  if (isSuperAdmin(user)) {
    throw new ApiError(403, 'SUPER_ADMIN_PROTECTED', 'Super Admin permission overrides are not editable');
  }

  if (!body?.overrides || typeof body.overrides !== 'object') {
    throw new ApiError(400, 'OVERRIDES_REQUIRED', 'overrides object is required');
  }

  const overrides = normaliseUserOverrides(body.overrides);
  const previousDoc = await UserPermissionOverride.findOne({ user: userId });
  const previous = entriesToOverrides(previousDoc?.entries);

  let doc = null;
  if (Object.keys(overrides).length === 0) {
    if (body.ifMatch) {
      const expectedUpdatedAt = parseIfMatchTimestamp(body.ifMatch);
      if (!expectedUpdatedAt) throw buildPolicyConflictError();
      const deleted = await UserPermissionOverride.findOneAndDelete({
        user: userId,
        updatedAt: expectedUpdatedAt,
      });
      if (!deleted) throw buildPolicyConflictError();
    } else {
      await UserPermissionOverride.deleteOne({ user: userId });
    }
  } else if (body.ifMatch) {
    const expectedUpdatedAt = parseIfMatchTimestamp(body.ifMatch);
    if (!expectedUpdatedAt) throw buildPolicyConflictError();
    doc = await UserPermissionOverride.findOneAndUpdate(
      { user: userId, updatedAt: expectedUpdatedAt },
      {
        $set: {
          entries: overridesToEntries(overrides),
          updatedBy: actor._id,
        },
      },
      { new: true, runValidators: true },
    );
    if (!doc) throw buildPolicyConflictError();
  } else {
    doc = await UserPermissionOverride.findOneAndUpdate(
      { user: userId },
      {
        $set: {
          entries: overridesToEntries(overrides),
          updatedBy: actor._id,
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
  }

  const roleMatrix = await loadStoredMatrixRecord();
  const roleMatrixRecord = roleMatrix ? mergeRoleMatrixWithBaseline(roleMatrix) : null;
  const userJson = user.toJSON();

  await auditRbacChange(actor, 'user_overrides.update', {
    userId: String(userId),
    previous,
    next: overrides,
  });

  return {
    userId: userJson.id,
    overrides,
    baseline: [...getRoleBaselinePermissions(userJson, roleMatrixRecord)].sort(),
    effective: [...getEffectivePermissions(userJson, {
      roleMatrix: roleMatrixRecord,
      userOverrides: overrides,
    })].sort(),
    updatedAt: doc?.updatedAt ?? null,
    updatedBy: doc?.updatedBy ?? null,
  };
}

export async function clearUserPermissionOverrides(actor, userId) {
  return updateUserPermissionOverrides(actor, userId, { overrides: {} });
}

export async function listAuditLog(actor, query = {}) {
  assertCanManageRbac(actor);

  const filter = {};
  if (query.category) filter.category = query.category;
  if (query.action) filter.action = query.action;
  if (query.targetUserId) filter.targetUser = query.targetUserId;

  const page = await paginate(RbacAuditLog, filter, {
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy || 'createdAt:desc',
    populate: [
      { path: 'actor', select: 'name email' },
      { path: 'targetUser', select: 'name email' },
    ],
  });

  return {
    results: page.results.map(serialiseAuditRow),
    page: page.page,
    limit: page.limit,
    totalPages: page.totalPages,
    totalResults: page.totalResults,
  };
}
