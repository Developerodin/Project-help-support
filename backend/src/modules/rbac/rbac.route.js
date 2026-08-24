import express from 'express';
import { ADMIN_ROLES } from '@pms/shared';
import { auth, requirePermission, requireRole } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import * as controller from './rbac.controller.js';
import {
  updateRoleMatrixSchema,
  updateUserOverridesSchema,
  updateBoardPermissionsSchema,
  userIdSchema,
  createScopedAssignmentSchema,
  updateScopedAssignmentSchema,
  revokeScopedAssignmentSchema,
  listAuditLogSchema,
} from './rbac.validation.js';

export default function rbacRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  const requireRbacAdmin = requireRole(...ADMIN_ROLES);

  router.get('/role-matrix', requireRbacAdmin, controller.getRoleMatrix);
  router.get('/role-matrix/effective', controller.getRoleMatrixEffective);
  router.put('/role-matrix', requireRbacAdmin, validate(updateRoleMatrixSchema), controller.updateRoleMatrix);
  router.delete('/role-matrix', requireRbacAdmin, controller.resetRoleMatrix);

  router.get('/board-permissions', requireRbacAdmin, controller.getBoardPermissions);
  router.put('/board-permissions', requireRbacAdmin, validate(updateBoardPermissionsSchema), controller.updateBoardPermissions);
  router.delete('/board-permissions', requireRbacAdmin, controller.resetBoardPermissions);
  router.get('/board-permissions/effective', controller.getBoardPermissionsEffective);

  router.get(
    '/users/:userId/permission-overrides',
    requireRbacAdmin,
    validate(userIdSchema),
    controller.getUserOverrides,
  );
  router.put(
    '/users/:userId/permission-overrides',
    requireRbacAdmin,
    validate(updateUserOverridesSchema),
    controller.updateUserOverrides,
  );
  router.delete(
    '/users/:userId/permission-overrides',
    requireRbacAdmin,
    validate(userIdSchema),
    controller.clearUserOverrides,
  );

  router.get(
    '/users/:userId/scoped-assignments',
    requirePermission('access.view'),
    validate(userIdSchema),
    controller.listUserScopedAssignments,
  );
  router.post(
    '/users/:userId/scoped-assignments',
    requirePermission('access.grant'),
    validate(createScopedAssignmentSchema),
    controller.createUserScopedAssignment,
  );
  router.patch(
    '/scoped-assignments/:assignmentId',
    requirePermission('access.grant'),
    validate(updateScopedAssignmentSchema),
    controller.updateScopedAssignment,
  );
  router.post(
    '/scoped-assignments/:assignmentId/revoke',
    requirePermission('access.revoke'),
    validate(revokeScopedAssignmentSchema),
    controller.revokeScopedAssignment,
  );

  router.get(
    '/audit-log',
    requireRbacAdmin,
    validate(listAuditLogSchema),
    controller.getAuditLog,
  );

  return router;
}
