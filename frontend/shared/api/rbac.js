import { apiFetch } from './client.js';

export const getRoleMatrix = () => apiFetch('/rbac/role-matrix');

export const updateRoleMatrix = (body) => apiFetch('/rbac/role-matrix', { method: 'PUT', body });

export const resetRoleMatrix = () => apiFetch('/rbac/role-matrix', { method: 'DELETE' });

export const getUserPermissionOverrides = (userId) =>
  apiFetch(`/rbac/users/${userId}/permission-overrides`);

export const updateUserPermissionOverrides = (userId, body) =>
  apiFetch(`/rbac/users/${userId}/permission-overrides`, { method: 'PUT', body });

export const clearUserPermissionOverrides = (userId) =>
  apiFetch(`/rbac/users/${userId}/permission-overrides`, { method: 'DELETE' });

export const listUserScopedAssignments = (userId) =>
  apiFetch(`/rbac/users/${userId}/scoped-assignments`);

export const createUserScopedAssignment = (userId, body) =>
  apiFetch(`/rbac/users/${userId}/scoped-assignments`, { method: 'POST', body });

export const updateScopedAssignment = (assignmentId, body) =>
  apiFetch(`/rbac/scoped-assignments/${assignmentId}`, { method: 'PATCH', body });

export const revokeScopedAssignment = (assignmentId, body) =>
  apiFetch(`/rbac/scoped-assignments/${assignmentId}/revoke`, { method: 'POST', body });

export const getRoleMatrixEffective = () => apiFetch('/rbac/role-matrix/effective');

export const getBoardPermissionsEffective = () => apiFetch('/rbac/board-permissions/effective');

export const getBoardPermissions = () => apiFetch('/rbac/board-permissions');

export const updateBoardPermissions = (body) => apiFetch('/rbac/board-permissions', { method: 'PUT', body });

export const resetBoardPermissions = () => apiFetch('/rbac/board-permissions', { method: 'DELETE' });

export const listAuditLog = (params = {}) => {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== ''),
  ).toString();
  return apiFetch(`/rbac/audit-log${search ? `?${search}` : ''}`);
};
