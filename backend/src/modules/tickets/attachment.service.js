import mongoose from 'mongoose';
import { isExternalUser } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { sniffType, safeKey } from '../../platform/upload.js';
import * as defaultStorage from '../../platform/s3.js';
import Ticket from './ticket.model.js';
import { resolveTicketDoc, assertCanViewTicket, assertCanDeleteTicket } from './ticket.service.js';
import { findComment } from './comment.service.js';
import { canExternalViewTicket } from '../access/external-auth.service.js';

const sameId = (a, b) => !!a && !!b && String(a._id ?? a) === String(b._id ?? b);

function findAttachment(ticket, attachmentId) {
  const attachment = ticket.attachments.id(attachmentId);
  if (!attachment) throw new ApiError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found');
  return attachment;
}

/**
 * `storage` is injected so the authorization and validation paths are testable
 * without a network. Production passes nothing and gets the real module.
 * The capability gate always comes from the real module, so a test double
 * cannot accidentally disable it.
 */
function attachmentReplay(ticket, clientRef) {
  if (!clientRef) return null;
  const attachments = ticket.attachments.filter((a) => a.clientRef === clientRef);
  return attachments.length ? attachments : null;
}

function commentReplay(ticket, commentClientRef) {
  if (!commentClientRef) return null;
  return ticket.comments.find((c) => c.clientRef === commentClientRef) || null;
}

function buildAttachmentResult(attachments, comment = null, commentCreated = false) {
  const result = { attachments, comment, commentCreated, event: null };
  if (commentCreated && comment) {
    result.event = {
      type: 'TICKET_COMMENTED',
      actorId: String(comment.commentedBy),
      commentId: String(comment._id),
      mentions: comment.mentions || [],
      at: comment.createdAt,
    };
  }
  return result;
}

export async function addAttachments(actor, idOrKey, files, config, opts = {}) {
  const storage = opts.storage ?? defaultStorage;
  const {
    clientRef,
    prefix = 'tickets',
    commentId,
    commentContent,
    commentClientRef,
    permissionContext = null,
  } = opts;

  defaultStorage.assertStorageEnabled(config);

  const ticket = await resolveTicketDoc(idOrKey);
  await assertCanViewTicket(actor, ticket, permissionContext);

  const replayedAttachments = attachmentReplay(ticket, clientRef);
  if (replayedAttachments) {
    const replayedComment = commentReplay(ticket, commentClientRef);
    return buildAttachmentResult(replayedAttachments, replayedComment, false);
  }

  if (commentClientRef) {
    const replayedComment = commentReplay(ticket, commentClientRef);
    if (replayedComment) {
      return buildAttachmentResult(replayedComment.attachments || [], replayedComment, false);
    }
  }

  if (commentId) {
    const targetComment = findComment(ticket, commentId);
    if (isExternalUser(actor) && targetComment.internal === true) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this ticket');
    }
  }

  // Validate EVERY file before uploading ANY of them: a batch that half-uploads
  // and then rejects leaves orphan objects in the bucket.
  const prepared = files.map((file) => {
    const { mime, ext } = sniffType(file.buffer, file.originalname);
    return {
      key: safeKey(String(actor._id), ext, { prefix }),
      name: file.originalname,
      size: file.size,
      mimeType: mime,
      uploadedBy: actor._id,
      uploadedAt: new Date(),
      clientRef,
      buffer: file.buffer,
    };
  });

  const uploadedKeys = [];
  try {
    for (const item of prepared) {
      await storage.putObject(config, {
        key: item.key, body: item.buffer, contentType: item.mimeType,
      });
      uploadedKeys.push(item.key);
    }
  } catch (err) {
    for (const key of uploadedKeys) {
      try {
        await storage.deleteObject(config, key);
      } catch {
        /* best-effort cleanup */
      }
    }
    throw err;
  }

  const entries = prepared.map(({ buffer: _buffer, ...rest }) => ({
    ...rest,
    _id: new mongoose.Types.ObjectId(),
  }));

  const activityEntry = {
    action: 'attachments_added',
    performedBy: actor._id,
    at: new Date(),
    changes: entries.map((e) => ({ field: 'attachment', from: null, to: e.name })),
  };

  const filter = { _id: ticket._id };
  if (clientRef) filter['attachments.clientRef'] = { $ne: clientRef };
  if (commentClientRef) filter['comments.clientRef'] = { $ne: commentClientRef };

  let update;
  let commentCreated = false;

  if (commentId) {
    update = {
      $push: {
        attachments: { $each: entries },
        'comments.$.attachments': { $each: entries.map((entry) => ({ ...entry })) },
        activityLog: activityEntry,
      },
    };
    filter['comments._id'] = commentId;
  } else if (commentContent) {
    const createdAt = new Date();
    const comment = {
      _id: new mongoose.Types.ObjectId(),
      content: commentContent,
      commentedBy: actor._id,
      mentions: [],
      attachments: entries.map((entry) => ({ ...entry })),
      clientRef: commentClientRef,
      internal: false,
      createdAt,
    };
    commentCreated = true;
    update = {
      $push: {
        attachments: { $each: entries },
        comments: comment,
        activityLog: activityEntry,
      },
    };
  } else {
    update = {
      $push: {
        attachments: { $each: entries },
        activityLog: activityEntry,
      },
    };
  }

  let written;
  try {
    written = await Ticket.findOneAndUpdate(filter, update, { new: true });
  } catch (err) {
    for (const key of uploadedKeys) {
      try {
        await storage.deleteObject(config, key);
      } catch {
        /* best-effort cleanup */
      }
    }
    throw err;
  }

  if (!written) {
    for (const key of uploadedKeys) {
      try {
        await storage.deleteObject(config, key);
      } catch {
        /* best-effort cleanup */
      }
    }
    const existing = await Ticket.findById(ticket._id);
    const replayed = attachmentReplay(existing, clientRef)
      || (commentClientRef ? commentReplay(existing, commentClientRef)?.attachments : null)
      || [];
    const replayedComment = commentReplay(existing, commentClientRef);
    return buildAttachmentResult(replayed, replayedComment, false);
  }

  const attachments = written.attachments.slice(-entries.length);
  let comment = null;

  if (commentId) {
    comment = written.comments.id(commentId);
  } else if (commentContent) {
    comment = commentClientRef
      ? written.comments.find((c) => c.clientRef === commentClientRef)
      : written.comments.at(-1);
  }

  return buildAttachmentResult(attachments, comment, commentCreated);
}

export async function removeAttachment(actor, idOrKey, attachmentId, config, opts = {}) {
  const storage = opts.storage ?? defaultStorage;
  const { permissionContext = null } = opts;
  defaultStorage.assertStorageEnabled(config);

  const ticket = await resolveTicketDoc(idOrKey);
  await assertCanDeleteTicket(actor, ticket, permissionContext);
  const attachment = findAttachment(ticket, attachmentId);

  await Ticket.updateOne(
    { _id: ticket._id },
    {
      $pull: {
        attachments: { _id: attachment._id },
        'comments.$[].attachments': { _id: attachment._id },
      },
      $push: {
        activityLog: {
          action: 'attachment_removed',
          performedBy: actor._id,
          at: new Date(),
          changes: [{ field: 'attachment', from: attachment.name, to: null }],
        },
      },
    },
  );

  // The object goes AFTER the row: an orphan S3 object is recoverable garbage;
  // a row pointing at a deleted object is a broken download for every user.
  await storage.deleteObject(config, attachment.key);

  return { id: String(attachment._id) };
}

/**
 * Whether attachmentId is internal-only on this ticket: filed on a comment
 * marked internal, or as stage-history evidence (the QA report screenshot,
 * internal for the same reason the stage note is).
 *
 * Hiding it from the ticket payload is not enough on its own — the download
 * route takes an id, so the id has to be refused here too.
 */
function attachmentIsInternal(ticket, attachmentId) {
  const carriesIt = (entry) => (entry.attachments || []).some((a) => sameId(a, attachmentId));
  return (ticket.comments || []).some((c) => c.internal === true && carriesIt(c))
    || (ticket.stageHistory || []).some(carriesIt);
}

/**
 * The full auth stack has already run as middleware. This confirms the
 * attachment belongs to THIS ticket, and only then mints a URL.
 */
export async function downloadUrl(actor, idOrKey, attachmentId, config, opts = {}) {
  const storage = opts.storage ?? defaultStorage;
  defaultStorage.assertStorageEnabled(config);

  const ticket = await resolveTicketDoc(idOrKey);
  await assertCanViewTicket(actor, ticket);

  // A ticket in scope may still carry internal-only attachments; those are
  // not — same message as the scope gate, no oracle differential.
  if (isExternalUser(actor) && attachmentIsInternal(ticket, attachmentId)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this ticket');
  }

  const attachment = findAttachment(ticket, attachmentId);

  return storage.presignGet(config, attachment.key);
}
