import express from 'express';
import { can, isExternalUser } from '@pms/shared';
import { auth, requirePermission } from '../../platform/auth.js';
import { ApiError } from '../../platform/errors.js';
import { validate } from '../../platform/validate.js';
import { uploadMiddleware } from '../../platform/upload.js';
import * as controller from './project.controller.js';
import {
  listProjectsSchema, createProjectSchema, projectIdSchema,
  updateProjectSchema, replaceModulesSchema, projectTeamMembersSchema,
  replaceClientTestersSchema,
  uiQaStatusSchema, uiQaCommentSchema, uiQaEditCommentSchema,
  uiQaCommentIdSchema, uiQaAttachmentIdSchema, uiQaDeleteAttachmentSchema,
  uiQaEntityQuerySchema,
} from './project.validation.js';

function requireProjectView(req, _res, next) {
  if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
  if (isExternalUser(req.user)) return next();
  if (!can(req.user, 'clients.view', req.permissionContext)
    || !can(req.user, 'projects.view', req.permissionContext)) {
    return next(new ApiError(403, 'FORBIDDEN', 'Requires permissions: clients.view and projects.view'));
  }
  return next();
}

function requireUiQaPermission(permission) {
  const EXTERNAL_ACCESS_ASSIGNMENT_PERMISSIONS = new Set(['ui_qa.view']);
  return function check(req, _res, next) {
    if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
    if (isExternalUser(req.user) && EXTERNAL_ACCESS_ASSIGNMENT_PERMISSIONS.has(permission)) return next();
    if (!can(req.user, permission, req.permissionContext)) {
      return next(new ApiError(403, 'FORBIDDEN', `Requires permission: ${permission}`));
    }
    return next();
  };
}

export default function projectRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', requireProjectView, validate(listProjectsSchema), controller.list);
  router.post('/', requirePermission('projects.manage'), validate(createProjectSchema), controller.create);
  router.get('/:id', requireProjectView, validate(projectIdSchema), controller.get);
  router.patch('/:id', requirePermission('projects.manage'), validate(updateProjectSchema), controller.update);
  router.put('/:id/modules', requirePermission('projects.manage'),
    validate(replaceModulesSchema), controller.modules);
  router.get('/:id/team-members', validate(projectIdSchema), controller.teamMembers);
  router.get('/:id/client-testers', validate(projectIdSchema), controller.clientTesters);
  router.put('/:id/client-testers', requirePermission('projects.manage'),
    validate(replaceClientTestersSchema), controller.replaceClientTesters);
  router.put('/:id/team-members', requirePermission('projects.manage'),
    validate(projectTeamMembersSchema), controller.replaceTeamMembers);

  router.get('/:id/ui-qa', requireUiQaPermission('ui_qa.view'), validate(projectIdSchema), controller.uiQaGet);
  router.get('/:id/ui-qa/entity', requireUiQaPermission('ui_qa.view'), validate(uiQaEntityQuerySchema), controller.uiQaGetEntity);
  router.patch('/:id/ui-qa/status', requireUiQaPermission('ui_qa.edit'),
    validate(uiQaStatusSchema), controller.uiQaStatus);
  router.post('/:id/ui-qa/comments', requireUiQaPermission('ui_qa.view'),
    validate(uiQaCommentSchema), controller.uiQaAddComment);
  router.patch('/:id/ui-qa/comments/:commentId', requireUiQaPermission('ui_qa.edit'),
    validate(uiQaEditCommentSchema), controller.uiQaEditComment);
  router.delete('/:id/ui-qa/comments/:commentId', requireUiQaPermission('ui_qa.edit'),
    validate(uiQaCommentIdSchema), controller.uiQaDeleteComment);
  router.post('/:id/ui-qa/attachments', requireUiQaPermission('ui_qa.view'),
    uploadMiddleware, controller.uiQaAddAttachments(config));
  router.delete('/:id/ui-qa/attachments/:attachmentId', requireUiQaPermission('ui_qa.delete'),
    validate(uiQaDeleteAttachmentSchema), controller.uiQaRemoveAttachment);
  router.get('/:id/ui-qa/attachments/:attachmentId/download', requireUiQaPermission('ui_qa.view'),
    validate(uiQaAttachmentIdSchema), controller.uiQaDownloadAttachment(config));

  return router;
}
