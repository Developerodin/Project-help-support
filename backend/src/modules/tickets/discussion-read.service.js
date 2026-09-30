import mongoose from 'mongoose';
import { isPureExternalActor } from '@pms/shared';
import TicketReadState from './ticket-read-state.model.js';
import Ticket from './ticket.model.js';
import { resolveTicketDoc, assertCanViewTicket } from './ticket.service.js';

/**
 * Tickets with no TicketReadState row are treated as read through this instant so
 * pre-deploy comments do not flood the list as unread. Set at deploy; see
 * scripts/migrate-discussion-read-baseline.mjs.
 */
export const DISCUSSION_READ_BASELINE_AT = new Date('2026-09-21T00:00:00.000Z');

const actorObjectId = (actor) => new mongoose.Types.ObjectId(actor._id);

const personId = (v) => (v == null ? null : String(v._id ?? v));

/**
 * THE discussion audience: ticket raiser, assigned tester, and watchers. The
 * unread badges, the "New replies" filter and the realtime comment fan-out all
 * read from here, so a person cannot be told about a reply in one place and not
 * another.
 */
export function discussionAudienceIds(ticket) {
  if (!ticket) return [];
  const ids = [ticket.createdBy, ticket.testedBy, ...(ticket.watchers || [])]
    .map(personId)
    .filter(Boolean);
  return [...new Set(ids)];
}

export function isDiscussionUnreadAudience(ticket, actor) {
  if (!ticket || !actor) return false;
  const actorId = personId(actor._id ?? actor.id);
  return actorId != null && discussionAudienceIds(ticket).includes(actorId);
}

function audienceMatchExpr(actorId) {
  return {
    $or: [
      { $eq: ['$createdBy', actorId] },
      { $eq: ['$testedBy', actorId] },
      { $in: [actorId, { $ifNull: ['$watchers', []] }] },
    ],
  };
}

function visibleCommentFilterCond(actorId, external) {
  const base = [
    { $gt: ['$$c.createdAt', '$effectiveLastReadAt'] },
    { $ne: ['$$c.commentedBy', actorId] },
  ];
  if (external) base.push({ $ne: ['$$c.internal', true] });
  return { $and: base };
}

function readStateLookupStages(actorId) {
  return [
    {
      $lookup: {
        from: TicketReadState.collection.name,
        let: { ticketId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$ticket', '$$ticketId'] },
                  { $eq: ['$user', actorId] },
                ],
              },
            },
          },
          { $project: { lastReadAt: 1 } },
        ],
        as: '_readState',
      },
    },
    {
      $addFields: {
        effectiveLastReadAt: {
          $ifNull: [
            { $arrayElemAt: ['$_readState.lastReadAt', 0] },
            DISCUSSION_READ_BASELINE_AT,
          ],
        },
      },
    },
  ];
}

function unreadCountAddFields(actor) {
  const actorId = actorObjectId(actor);
  const external = isPureExternalActor(actor);
  const unreadSize = {
    $size: {
      $filter: {
        input: { $ifNull: ['$comments', []] },
        as: 'c',
        cond: visibleCommentFilterCond(actorId, external),
      },
    },
  };
  return {
    $addFields: {
      discussionUnreadCount: {
        $cond: {
          if: audienceMatchExpr(actorId),
          then: unreadSize,
          else: 0,
        },
      },
    },
  };
}

export function filterVisibleComments(comments, actor) {
  const external = isPureExternalActor(actor);
  const list = comments || [];
  if (!external) return list;
  return list.filter((c) => c.internal !== true);
}

export async function markDiscussionRead(actor, idOrKey, permissionContext = null) {
  const ticket = await resolveTicketDoc(idOrKey);
  await assertCanViewTicket(actor, ticket, permissionContext);

  if (!isDiscussionUnreadAudience(ticket, actor)) {
    return { lastReadAt: new Date() };
  }

  const visible = filterVisibleComments(ticket.comments, actor);
  const lastReadAt = visible.length
    ? new Date(Math.max(...visible.map((c) => new Date(c.createdAt).getTime())))
    : new Date();

  await TicketReadState.findOneAndUpdate(
    { user: actor._id, ticket: ticket._id },
    { $set: { lastReadAt } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  return { lastReadAt };
}

/**
 * Map ticket id → { discussionUnreadCount, hasNewReply } for a page of list results.
 */
function latestUnreadCommentAuthorStages(actor) {
  const actorId = actorObjectId(actor);
  const external = isPureExternalActor(actor);
  const isUnreadComment = {
    $and: [
      { $gt: ['$$this.createdAt', '$effectiveLastReadAt'] },
      { $ne: ['$$this.commentedBy', actorId] },
      ...(external ? [{ $ne: ['$$this.internal', true] }] : []),
    ],
  };
  return [
    {
      $addFields: {
        _latestUnreadComment: {
          $reduce: {
            input: { $ifNull: ['$comments', []] },
            initialValue: null,
            in: {
              $cond: [
                isUnreadComment,
                {
                  $cond: [
                    {
                      $or: [
                        { $eq: ['$$value', null] },
                        { $gt: ['$$this.createdAt', '$$value.createdAt'] },
                      ],
                    },
                    '$$this',
                    '$$value',
                  ],
                },
                '$$value',
              ],
            },
          },
        },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_latestUnreadComment.commentedBy',
        foreignField: '_id',
        as: '_latestUnreadAuthorDoc',
      },
    },
  ];
}

export function discussionUnreadSortStages(actor, direction = -1) {
  const actorId = actorObjectId(actor);
  return [
    ...readStateLookupStages(actorId),
    unreadCountAddFields(actor),
    { $sort: { discussionUnreadCount: direction, createdAt: -1, _id: -1 } },
  ];
}

export async function discussionUnreadByTicketIds(actor, ticketIds) {
  if (!ticketIds.length) return new Map();

  const actorId = actorObjectId(actor);
  const rows = await Ticket.aggregate([
    { $match: { _id: { $in: ticketIds } } },
    ...readStateLookupStages(actorId),
    unreadCountAddFields(actor),
    ...latestUnreadCommentAuthorStages(actor),
    {
      $project: {
        _id: 1,
        discussionUnreadCount: 1,
        hasNewReply: { $gt: ['$discussionUnreadCount', 0] },
        lastUnreadCommentAuthor: {
          $cond: {
            if: audienceMatchExpr(actorId),
            then: { $arrayElemAt: ['$_latestUnreadAuthorDoc.name', 0] },
            else: null,
          },
        },
      },
    },
  ]);

  return new Map(
    rows.map((row) => [
      String(row._id),
      {
        discussionUnreadCount: row.discussionUnreadCount ?? 0,
        hasNewReply: Boolean(row.hasNewReply),
        lastUnreadCommentAuthor: row.lastUnreadCommentAuthor ?? null,
      },
    ]),
  );
}

export function attachDiscussionUnreadToTicketJson(ticketJson, unreadMeta) {
  const count = unreadMeta?.discussionUnreadCount ?? 0;
  return {
    ...ticketJson,
    discussionUnreadCount: count,
    hasNewReply: count > 0,
    lastUnreadCommentAuthor: count > 0 ? (unreadMeta?.lastUnreadCommentAuthor ?? null) : null,
  };
}

/**
 * Aggregation stages appended after the list $match to keep only tickets with unread discussion.
 */
export function discussionNewReplyFilterStages(actor) {
  const actorId = actorObjectId(actor);
  return [
    { $match: { $expr: audienceMatchExpr(actorId) } },
    ...readStateLookupStages(actorId),
    unreadCountAddFields(actor),
    { $match: { discussionUnreadCount: { $gt: 0 } } },
  ];
}

export async function discussionLastReadAtForTicket(actor, ticket) {
  if (!isDiscussionUnreadAudience(ticket, actor)) return null;
  const state = await TicketReadState.findOne({
    user: actor._id,
    ticket: ticket._id,
  }).lean();
  return state?.lastReadAt ?? DISCUSSION_READ_BASELINE_AT;
}
