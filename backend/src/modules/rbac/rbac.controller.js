import catchAsync from '../../platform/catchAsync.js';
import { auditContextFromRequest } from './rbac-audit.js';
import { assertEffectivePermission } from '../../platform/effective-permission.js';
import * as rbacService from './rbac.service.js';
import * as scopedAccessService from '../access/scoped-access.service.js';


const auditCtx = (req) => auditContextFromRequest(req);



export const getRoleMatrix = catchAsync(async (req, res) => {

  res.json(await rbacService.getRoleMatrix(req.user));

});



export const updateRoleMatrix = catchAsync(async (req, res) => {

  res.json(await rbacService.updateRoleMatrix(req.user, req.body, auditCtx(req)));

});



export const resetRoleMatrix = catchAsync(async (req, res) => {

  res.json(await rbacService.resetRoleMatrix(req.user, auditCtx(req)));

});



export const getUserOverrides = catchAsync(async (req, res) => {

  res.json(await rbacService.getUserPermissionOverrides(req.user, req.params.userId));

});



export const updateUserOverrides = catchAsync(async (req, res) => {

  res.json(await rbacService.updateUserPermissionOverrides(

    req.user,

    req.params.userId,

    req.body,

    auditCtx(req),

  ));

});



export const clearUserOverrides = catchAsync(async (req, res) => {

  res.json(await rbacService.clearUserPermissionOverrides(req.user, req.params.userId));

});



export const listUserScopedAssignments = catchAsync(async (req, res) => {

  res.json(await scopedAccessService.listUserScopedAssignments(req.user, req.params.userId));

});



export const createUserScopedAssignment = catchAsync(async (req, res) => {

  res.status(201).json(

    await scopedAccessService.createScopedAssignment(

      req.user,

      req.params.userId,

      req.body,

      auditCtx(req),

    ),

  );

});



export const updateScopedAssignment = catchAsync(async (req, res) => {

  res.json(await scopedAccessService.updateScopedAssignment(

    req.user,

    req.params.assignmentId,

    req.body,

    auditCtx(req),

  ));

});



export const revokeScopedAssignment = catchAsync(async (req, res) => {

  res.json(await scopedAccessService.revokeScopedAssignment(

    req.user,

    req.params.assignmentId,

    req.body,

    auditCtx(req),

  ));

});



export const getAuditLog = catchAsync(async (req, res) => {

  res.json(await rbacService.listAuditLog(req.user, req.query, {

    permissionContext: req.permissionContext,

    impersonation: req.impersonation,

  }));

});



export const exportAuditLog = catchAsync(async (req, res) => {

  const csv = await rbacService.exportAuditLog(req.user, req.query, {

    permissionContext: req.permissionContext,

    impersonation: req.impersonation,

  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');

  res.setHeader('Content-Disposition', 'attachment; filename="rbac-audit-log.csv"');

  res.status(200).send(csv);

});



export const getAuditOutboxStats = catchAsync(async (req, res) => {
  await assertEffectivePermission(
    req.user,
    'audit.view',
    req.permissionContext,
    req.impersonation,
  );
  res.json(await rbacService.getAuditOutboxStats());
});


export const getBoardPermissions = catchAsync(async (req, res) => {

  res.json(await rbacService.getBoardPermissions(req.user));

});



export const updateBoardPermissions = catchAsync(async (req, res) => {

  res.json(await rbacService.updateBoardPermissions(req.user, req.body, auditCtx(req)));

});



export const resetBoardPermissions = catchAsync(async (req, res) => {

  res.json(await rbacService.resetBoardPermissions(req.user, auditCtx(req)));

});



export const getBoardPermissionsEffective = catchAsync(async (req, res) => {

  res.json(await rbacService.getBoardPermissionsEffective(req.user));

});



export const getRoleMatrixEffective = catchAsync(async (req, res) => {

  res.json(await rbacService.getRoleMatrixEffective(req.user));

});


