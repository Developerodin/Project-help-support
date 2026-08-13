import { ApiError } from '../../platform/errors.js';
import { sniffType, safeKey } from '../../platform/upload.js';
import * as defaultStorage from '../../platform/s3.js';
import Ticket from './ticket.model.js';
import { resolveTicketDoc, assertCanEditTicket } from './ticket.service.js';

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
export async function addAttachments(actor, idOrKey, files, config, opts = {}) {
  const storage = opts.storage ?? defaultStorage;
  const { clientRef, prefix = 'tickets' } = opts;

  defaultStorage.assertStorageEnabled(config);

  const ticket = await resolveTicketDoc(idOrKey);
  assertCanEditTicket(actor, ticket);

  if (clientRef && ticket.attachments.some((a) => a.clientRef === clientRef)) {
    return ticket.attachments.filter((a) => a.clientRef === clientRef);
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

  for (const item of prepared) {
    await storage.putObject(config, {
      key: item.key, body: item.buffer, contentType: item.mimeType,
    });
  }

  const entries = prepared.map(({ buffer: _buffer, ...rest }) => rest);

  const filter = clientRef
    ? { _id: ticket._id, 'attachments.clientRef': { $ne: clientRef } }
    : { _id: ticket._id };

  const written = await Ticket.findOneAndUpdate(
    filter,
    {
      $push: {
        attachments: { $each: entries },
        activityLog: {
          action: 'attachments_added',
          performedBy: actor._id,
          at: new Date(),
          changes: entries.map((e) => ({ field: 'attachment', from: null, to: e.name })),
        },
      },
    },
    { new: true },
  );

  if (!written) {
    const existing = await Ticket.findById(ticket._id);
    return existing.attachments.filter((a) => a.clientRef === clientRef);
  }

  return written.attachments.slice(-entries.length);
}

export async function removeAttachment(actor, idOrKey, attachmentId, config, opts = {}) {
  const storage = opts.storage ?? defaultStorage;
  defaultStorage.assertStorageEnabled(config);

  const ticket = await resolveTicketDoc(idOrKey);
  const attachment = findAttachment(ticket, attachmentId);

  if (!sameId(attachment.uploadedBy, actor._id) && actor.role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'Only the uploader or an admin may delete an attachment');
  }

  await Ticket.updateOne(
    { _id: ticket._id },
    {
      $pull: { attachments: { _id: attachment._id } },
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
 * The full auth stack has already run as middleware. This confirms the
 * attachment belongs to THIS ticket, and only then mints a URL.
 */
export async function downloadUrl(actor, idOrKey, attachmentId, config, opts = {}) {
  const storage = opts.storage ?? defaultStorage;
  defaultStorage.assertStorageEnabled(config);

  const ticket = await resolveTicketDoc(idOrKey);
  const attachment = findAttachment(ticket, attachmentId);

  return storage.presignGet(config, attachment.key, { filename: attachment.name });
}
