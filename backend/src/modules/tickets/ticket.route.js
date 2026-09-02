import express from 'express';
import { auth } from '../../platform/auth.js';
import { isExternalUser, can } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { validate } from '../../platform/validate.js';
import { uploadMiddleware } from '../../platform/upload.js';
import * as controller from './ticket.controller.js';
import {
  listTicketsSchema, createTicketSchema, ticketIdSchema,
  patchTicketSchema, assignTicketSchema, bulkSchema,
  transitionSchema, addCommentSchema, commentIdSchema,
  editCommentSchema, reactionSchema, attachmentIdSchema, addAttachmentsSchema,
  setBlockedSchema, clearBlockedSchema,
} from './ticket.validation.js';

const EXTERNAL_ACCESS_ASSIGNMENT_PERMISSIONS = new Set(['tickets.view', 'tickets.create']);

function requireTicketPermission(permission) {
  return function check(req, _res, next) {
    if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
    // External visibility and filing are governed by AccessAssignment scope, not RBAC.
    if (isExternalUser(req.user) && EXTERNAL_ACCESS_ASSIGNMENT_PERMISSIONS.has(permission)) return next();
    if (!can(req.user, permission, req.permissionContext)) {
      return next(new ApiError(403, 'FORBIDDEN', `Requires permission: ${permission}`));
    }
    return next();
  };
}

function requireInternalPermission(permission) {
  return requireTicketPermission(permission);
}

function requireBulkPermission(req, _res, next) {
  if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
  if (isExternalUser(req.user)) {
    return next(new ApiError(403, 'FORBIDDEN', 'Bulk ticket operations are not available to external users'));
  }
  const action = req.body?.action;
  const permission = action === 'delete' ? 'tickets.delete' : 'tickets.edit';
  if (!can(req.user, permission, req.permissionContext)) {
    return next(new ApiError(403, 'FORBIDDEN', `Requires permission: ${permission}`));
  }
  return next();
}

export default function ticketRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', requireTicketPermission('tickets.view'), validate(listTicketsSchema), controller.list);
  router.post('/', requireTicketPermission('tickets.create'), validate(createTicketSchema), controller.create(config));

  // Before /:id, or "bulk" is parsed as a ticket reference.
  router.post('/bulk', requireBulkPermission, validate(bulkSchema), controller.bulk);

  router.get('/:id', requireTicketPermission('tickets.view'), validate(ticketIdSchema), controller.get);
  router.patch('/:id', requireTicketPermission('tickets.edit'), validate(patchTicketSchema), controller.patch(config));
  router.delete('/:id', requireTicketPermission('tickets.delete'), validate(ticketIdSchema), controller.remove);

  router.post('/:id/assign', requireTicketPermission('tickets.edit'), validate(assignTicketSchema), controller.assign(config));
  router.post('/:id/transition', requireTicketPermission('tickets.view'), validate(transitionSchema), controller.transition(config));
  router.post('/:id/watch', requireInternalPermission('tickets.view'), validate(ticketIdSchema), controller.watch);
  router.delete('/:id/watch', requireInternalPermission('tickets.view'), validate(ticketIdSchema), controller.unwatch);
  router.post('/:id/block', requireInternalPermission('tickets.edit'), validate(setBlockedSchema), controller.setBlocked);
  router.delete('/:id/block', requireInternalPermission('tickets.edit'), validate(clearBlockedSchema), controller.clearBlocked);

  router.post('/:id/comments', requireTicketPermission('tickets.view'), validate(addCommentSchema), controller.addComment(config));
  // Own-comment edit/delete for externals is enforced in comment.service; route gate matches add comment.
  router.patch('/:id/comments/:commentId', requireTicketPermission('tickets.view'), validate(editCommentSchema), controller.editComment);
  router.delete('/:id/comments/:commentId', requireTicketPermission('tickets.view'), validate(commentIdSchema), controller.deleteComment);
  router.put('/:id/comments/:commentId/reactions',
    requireTicketPermission('tickets.view'), validate(reactionSchema), controller.reactToComment);

  router.post('/:id/attachments', requireTicketPermission('tickets.view'), uploadMiddleware,
    validate(addAttachmentsSchema), controller.addAttachments(config));
  router.delete('/:id/attachments/:attachmentId',
    requireTicketPermission('tickets.delete'), validate(attachmentIdSchema), controller.removeAttachment(config));
  router.get('/:id/attachments/:attachmentId/download',
    validate(attachmentIdSchema), controller.downloadAttachment(config));

  return router;
}