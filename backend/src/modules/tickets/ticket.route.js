import express from 'express';
import { auth, requirePermission } from '../../platform/auth.js';
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

function requireInternalPermission(permission) {
  return function check(req, _res, next) {
    if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
    if (isExternalUser(req.user)) return next();
    if (!can(req.user, permission, req.permissionContext)) {
      return next(new ApiError(403, 'FORBIDDEN', `Requires permission: ${permission}`));
    }
    return next();
  };
}

function requireTicketCreate(req, _res, next) {
  return requireInternalPermission('tickets.create')(req, _res, next);
}

function requireBulkPermission(req, _res, next) {
  if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
  if (isExternalUser(req.user)) {
    return next(new ApiError(403, 'FORBIDDEN', 'Bulk ticket operations are not available to external users'));
  }
  const action = req.body?.action;
  const permission = action === 'delete' ? 'tickets.delete' : 'tickets.manage_assignment';
  if (!can(req.user, permission, req.permissionContext)) {
    return next(new ApiError(403, 'FORBIDDEN', `Requires permission: ${permission}`));
  }
  return next();
}

export default function ticketRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', validate(listTicketsSchema), controller.list);
  router.post('/', requireTicketCreate, validate(createTicketSchema), controller.create(config));

  // Before /:id, or "bulk" is parsed as a ticket reference.
  router.post('/bulk', requireBulkPermission, validate(bulkSchema), controller.bulk);

  router.get('/:id', validate(ticketIdSchema), controller.get);
  router.patch('/:id', requirePermission('tickets.edit'), validate(patchTicketSchema), controller.patch(config));
  router.delete('/:id', requirePermission('tickets.delete'), validate(ticketIdSchema), controller.remove);

  router.post('/:id/assign', requirePermission('tickets.manage_assignment'), validate(assignTicketSchema), controller.assign(config));
  router.post('/:id/transition', requireInternalPermission('tickets.manage_stage'), validate(transitionSchema), controller.transition(config));
  router.post('/:id/watch', requireInternalPermission('tickets.view'), validate(ticketIdSchema), controller.watch);
  router.delete('/:id/watch', requireInternalPermission('tickets.view'), validate(ticketIdSchema), controller.unwatch);
  router.post('/:id/block', requireInternalPermission('tickets.edit'), validate(setBlockedSchema), controller.setBlocked);
  router.delete('/:id/block', requireInternalPermission('tickets.edit'), validate(clearBlockedSchema), controller.clearBlocked);

  router.post('/:id/comments', requireInternalPermission('tickets.manage_comments'), validate(addCommentSchema), controller.addComment(config));
  router.patch('/:id/comments/:commentId', validate(editCommentSchema), controller.editComment);
  router.delete('/:id/comments/:commentId', validate(commentIdSchema), controller.deleteComment);
  router.put('/:id/comments/:commentId/reactions',
    validate(reactionSchema), controller.reactToComment);

  router.post('/:id/attachments', requireInternalPermission('tickets.manage_attachments'), uploadMiddleware,
    validate(addAttachmentsSchema), controller.addAttachments(config));
  router.delete('/:id/attachments/:attachmentId',
    validate(attachmentIdSchema), controller.removeAttachment(config));
  router.get('/:id/attachments/:attachmentId/download',
    validate(attachmentIdSchema), controller.downloadAttachment(config));

  return router;
}