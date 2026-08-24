import catchAsync from '../../platform/catchAsync.js';
import * as rbacService from './rbac.service.js';
import * as scopedAccessService from '../access/scoped-access.service.js';

export const getRoleMatrix = catchAsync(async (req, res) => {
  res.json(await rbacService.getRoleMatrix(req.user));
});

export const updateRoleMatrix = catchAsync(async (req, res) => {
  res.json(await rbacService.updateRoleMatrix(req.user, req.body));
});

export const resetRoleMatrix = catchAsync(async (req, res) => {
  res.json(await rbacService.resetRoleMatrix(req.user));
});

export const getUserOverrides = catchAsync(async (req, res) => {
  res.json(await rbacService.getUserPermissionOverrides(req.user, req.params.userId));
});

export const updateUserOverrides = catchAsync(async (req, res) => {
  res.json(await rbacService.updateUserPermissionOverrides(req.user, req.params.userId, req.body));
});

export const clearUserOverrides = catchAsync(async (req, res) => {
  res.json(await rbacService.clearUserPermissionOverrides(req.user, req.params.userId));
});

export const listUserScopedAssignments = catchAsync(async (req, res) => {
  res.json(await scopedAccessService.listUserScopedAssignments(req.user, req.params.userId));
});

export const createUserScopedAssignment = catchAsync(async (req, res) => {
  res.status(201).json(
    await scopedAccessService.createScopedAssignment(req.user, req.params.userId, req.body),
  );
});

export const updateScopedAssignment = catchAsync(async (req, res) => {
  res.json(await scopedAccessService.updateScopedAssignment(req.user, req.params.assignmentId, req.body));
});

export const revokeScopedAssignment = catchAsync(async (req, res) => {
  res.json(await scopedAccessService.revokeScopedAssignment(req.user, req.params.assignmentId, req.body));
});

export const getAuditLog = catchAsync(async (req, res) => {
  res.json(await rbacService.listAuditLog(req.user, req.query));
});

export const getBoardPermissions = catchAsync(async (req, res) => {
  res.json(await rbacService.getBoardPermissions(req.user));
});

export const updateBoardPermissions = catchAsync(async (req, res) => {
  res.json(await rbacService.updateBoardPermissions(req.user, req.body));
});

export const resetBoardPermissions = catchAsync(async (req, res) => {
  res.json(await rbacService.resetBoardPermissions(req.user));
});

export const getBoardPermissionsEffective = catchAsync(async (req, res) => {
  res.json(await rbacService.getBoardPermissionsEffective(req.user));
});

export const getRoleMatrixEffective = catchAsync(async (req, res) => {
  res.json(await rbacService.getRoleMatrixEffective(req.user));
});
