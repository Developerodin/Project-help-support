import {
  PERMISSIONS,
  MATRIX_ROLES,
  PERMISSION_GROUPS,
  OVERRIDE_EDITABLE_PERMISSIONS,
  buildRoleMatrix,
  cloneRoleMatrix,
  matrixHasPermission,
  diffRoleMatrices,
  recordToRoleMatrix,
  roleMatrixToRecord,
  getRoleBaselinePermissions,
  getEffectivePermissions,
  roleBaselineHasPermission,
  userHasEffectivePermission,
  isAssignmentEffectivelyActive,
} from '@pms/shared';

export {
  PERMISSIONS,
  MATRIX_ROLES,
  PERMISSION_GROUPS,
  OVERRIDE_EDITABLE_PERMISSIONS,
  buildRoleMatrix,
  cloneRoleMatrix,
  matrixHasPermission,
  getRoleBaselinePermissions,
  getEffectivePermissions,
  roleBaselineHasPermission,
  userHasEffectivePermission,
  isAssignmentEffectivelyActive,
};

/** Active scoped rows that still grant access (excludes expired active rows). */
export function filterEffectivelyActiveAssignments(assignments = [], now = new Date()) {
  return assignments.filter((row) => isAssignmentEffectivelyActive(row, now));
}

/** Convert API role-matrix record into Set-based snapshot for the UI. */
export function recordToMatrixSnapshot(record) {
  return cloneRoleMatrix(recordToRoleMatrix(record || {}));
}

/** Convert Set-based snapshot into API grants payload. */
export function snapshotToGrantsRecord(snapshot) {
  return roleMatrixToRecord(snapshot);
}

export function diffMatrixSnapshots(fromSnapshot, toSnapshot) {
  return diffRoleMatrices(fromSnapshot, toSnapshot);
}

export function getUserOverrideMap(overrides, userId) {
  return overrides?.[userId] || {};
}

export function countUserOverrides(overrides, userId) {
  return Object.keys(getUserOverrideMap(overrides, userId)).length;
}

export function cloneUserOverrides(source = {}) {
  const clone = {};
  for (const [userId, deltas] of Object.entries(source)) {
    clone[userId] = { ...deltas };
  }
  return clone;
}

export function formatScope({ clientId, projectId, clientName, projectName } = {}) {
  if (!clientId && !projectId) {
    return { client: 'All clients', project: 'All projects', global: true };
  }
  return {
    client: clientName || (clientId ? 'Client' : 'All clients'),
    project: projectName || (projectId ? 'Project' : 'All projects'),
    global: false,
  };
}
