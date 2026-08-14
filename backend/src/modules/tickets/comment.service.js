import { ApiError } from '../../platform/errors.js';
import { assertActiveUsers } from '../teams/team.service.js';
import Ticket from './ticket.model.js';
import { resolveTicketDoc } from './ticket.service.js';

const sameId = (a, b) => !!a && !!b && String(a._id ?? a) === String(b._id ?? b);

export function findComment(ticket, commentId) {
  const comment = ticket.comments.id(commentId);
  if (!comment) throw new ApiError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
  return comment;
}

/**
 * Idempotency without a seventh collection, and without the partial unique
 * index the design first reached for.
 *
 * A unique index would NOT help here: MongoDB applies uniqueness across
 * SEPARATE documents, and explicitly allows one document's array to repeat an
 * index key. Two comments sharing a clientRef inside one ticket do not violate it.
 *
 * A conditional $push does help — `comments.clientRef: { $ne: ref }` is
 * evaluated as part of the same single-document write, so of two concurrent
 * submissions exactly one matches and the other returns null.
 */
export async function addComment(actor, idOrKey, { content, mentions = [], clientRef }) {
  const ticket = await resolveTicketDoc(idOrKey);
  await assertActiveUsers(mentions);

  const entry = { content, commentedBy: actor._id, mentions, clientRef, createdAt: new Date() };

  const filter = clientRef
    ? { _id: ticket._id, 'comments.clientRef': { $ne: clientRef } }
    : { _id: ticket._id };

  const written = await Ticket.findOneAndUpdate(
    filter, { $push: { comments: entry } }, { new: true },
  );

  if (!written) {
    // With a clientRef, the only way to miss is that it is already present.
    const existing = await Ticket.findById(ticket._id);
    const already = existing?.comments.find((c) => c.clientRef === clientRef);
    if (already) return { comment: already, created: false, event: null };
    throw new ApiError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
  }

  const comment = written.comments.at(-1);

  return {
    comment,
    created: true,
    event: {
      type: 'TICKET_COMMENTED',
      actorId: String(actor._id),
      commentId: String(comment._id),
      mentions,
      at: comment.createdAt,
    },
  };
}

export async function editComment(actor, idOrKey, commentId, { content }) {
  const ticket = await resolveTicketDoc(idOrKey);
  const comment = findComment(ticket, commentId);

  if (!sameId(comment.commentedBy, actor._id)) {
    throw new ApiError(403, 'FORBIDDEN', 'Only the author may edit a comment');
  }

  const now = new Date();
  await Ticket.updateOne(
    { _id: ticket._id, 'comments._id': comment._id },
    {
      $set: { 'comments.$.content': content, 'comments.$.editedAt': now },
      // The comment text changes; the RECORD of the change is appended, never
      // mutated. That is what keeps activityLog append-only.
      $push: {
        activityLog: {
          action: 'comment_edited',
          performedBy: actor._id,
          at: now,
          changes: [{ field: 'comment', from: comment.content, to: content }],
        },
      },
    },
  );

  return (await Ticket.findById(ticket._id)).comments.id(comment._id);
}

export async function deleteComment(actor, idOrKey, commentId) {
  const ticket = await resolveTicketDoc(idOrKey);
  const comment = findComment(ticket, commentId);

  const isAuthor = sameId(comment.commentedBy, actor._id);
  if (!isAuthor && actor.role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', 'Only the author or an admin may delete a comment');
  }

  await Ticket.updateOne(
    { _id: ticket._id },
    {
      $pull: { comments: { _id: comment._id } },
      $push: {
        activityLog: {
          action: 'comment_deleted',
          performedBy: actor._id,
          at: new Date(),
          changes: [{ field: 'comment', from: comment.content, to: null }],
        },
      },
    },
  );

  return { id: String(comment._id) };
}

/**
 * ponytail: a toggle implemented as remove-then-add-if-nothing-was-removed.
 * Two array filters keep it to single-document updates. A lost race here costs
 * one emoji, which is not worth a revision check.
 */
export async function toggleReaction(actor, idOrKey, commentId, emoji) {
  const ticket = await resolveTicketDoc(idOrKey);
  const comment = findComment(ticket, commentId);
  const commentObjectId = comment._id;
  const actorId = actor._id;

  const existing = (comment.reactions || []).find((r) => r.emoji === emoji);
  const already = existing
    ? existing.users.some((u) => String(u) === String(actorId))
    : false;

  if (!existing) {
    await Ticket.updateOne(
      { _id: ticket._id, 'comments._id': commentObjectId },
      { $push: { 'comments.$.reactions': { emoji, users: [actorId] } } },
    );
  } else if (already) {
    await Ticket.updateOne(
      { _id: ticket._id },
      { $pull: { 'comments.$[c].reactions.$[r].users': actorId } },
      { arrayFilters: [{ 'c._id': commentObjectId }, { 'r.emoji': emoji }] },
    );
  } else {
    await Ticket.updateOne(
      { _id: ticket._id },
      { $addToSet: { 'comments.$[c].reactions.$[r].users': actorId } },
      { arrayFilters: [{ 'c._id': commentObjectId }, { 'r.emoji': emoji }] },
    );
  }

  return (await Ticket.findById(ticket._id)).comments.id(commentObjectId);
}
