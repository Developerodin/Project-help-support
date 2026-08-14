import express from 'express';
import { auth, requireRole } from '../../platform/auth.js';
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

export default function ticketRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', validate(listTicketsSchema), controller.list);
  router.post('/', validate(createTicketSchema), controller.create(config));

  // Before /:id, or "bulk" is parsed as a ticket reference.
  router.post('/bulk', validate(bulkSchema), controller.bulk);

  router.get('/:id', validate(ticketIdSchema), controller.get);
  router.patch('/:id', validate(patchTicketSchema), controller.patch(config));
  router.delete('/:id', requireRole('admin'), validate(ticketIdSchema), controller.remove);

  router.post('/:id/assign', validate(assignTicketSchema), controller.assign(config));
  router.post('/:id/transition', validate(transitionSchema), controller.transition(config));
  router.post('/:id/watch', validate(ticketIdSchema), controller.watch);
  router.delete('/:id/watch', validate(ticketIdSchema), controller.unwatch);
  router.post('/:id/block', validate(setBlockedSchema), controller.setBlocked);
  router.delete('/:id/block', validate(clearBlockedSchema), controller.clearBlocked);

  router.post('/:id/comments', validate(addCommentSchema), controller.addComment(config));
  router.patch('/:id/comments/:commentId', validate(editCommentSchema), controller.editComment);
  router.delete('/:id/comments/:commentId', validate(commentIdSchema), controller.deleteComment);
  router.put('/:id/comments/:commentId/reactions',
    validate(reactionSchema), controller.reactToComment);

  router.post('/:id/attachments', uploadMiddleware,
    validate(addAttachmentsSchema), controller.addAttachments(config));
  router.delete('/:id/attachments/:attachmentId',
    validate(attachmentIdSchema), controller.removeAttachment(config));
  router.get('/:id/attachments/:attachmentId/download',
    validate(attachmentIdSchema), controller.downloadAttachment(config));

  return router;
}