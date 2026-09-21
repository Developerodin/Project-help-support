import mongoose from 'mongoose';
import { getProject } from '../projects/project.service.js';
import { discussionAudienceIds } from '../tickets/discussion-read.service.js';
import logger from '../../platform/logger.js';
import * as hub from './realtime-hub.js';

const idStr = (v) => (v ? String(v._id ?? v) : null);

/**
 * `?project=` names the channel a client joins, so it has to be checked against
 * the same rule the projects API uses — otherwise any authenticated user could
 * join any project id and watch its activity timing.
 *
 * A project the caller cannot see drops the scope instead of failing the
 * request: they keep the user-targeted ticket.comment events the unread badges
 * depend on, and only lose the project-wide refresh nudge.
 */
export async function resolveAuthorizedProjectScope(actor, rawProject, permissionContext = null) {
  if (rawProject == null || rawProject === '') return null;
  const projectId = String(rawProject).trim();
  if (!mongoose.isValidObjectId(projectId)) return null;

  try {
    await getProject(projectId, actor, permissionContext);
    return projectId;
  } catch (err) {
    logger.info('realtime.project_scope_denied', {
      userId: String(actor._id),
      projectId,
      reason: err.code || err.message,
    });
    return null;
  }
}

/** Same audience as the discussion unread badges: raiser, assigned tester, watchers. */
export function discussionAudienceUserIds(ticket, actorId) {
  const actor = actorId ? String(actorId) : null;
  return discussionAudienceIds(ticket).filter((id) => id !== actor);
}

export function projectIdOf(ticket) {
  return idStr(ticket?.project);
}

export function publishTicketCommentRealtime(ticket, actor) {
  const actorId = idStr(actor?._id ?? actor?.id);
  const projectId = projectIdOf(ticket);
  // Naming the ticket and the author is safe here and NOT on ticket.updated:
  // this goes only to the discussion audience, who can already open the ticket
  // and read the comment. The project channel below has no such guarantee.
  const payload = {
    type: 'ticket.comment',
    ticketId: ticket.ticketId,
    projectId,
    actorName: actor?.name ?? null,
  };
  hub.publishToUsers(discussionAudienceUserIds(ticket, actorId), payload);
}

export function publishTicketUpdatedRealtime(ticket, actor) {
  const actorId = idStr(actor?._id ?? actor?.id);
  const projectId = projectIdOf(ticket);
  if (!projectId) return;
  // No ticketId here. The project channel is joined by whatever ?project= the
  // client asks for, with no per-project authorization, so the payload must not
  // name a ticket. Clients only use this as a "refetch your list" nudge.
  const payload = {
    type: 'ticket.updated',
    projectId,
  };
  hub.publishToProject(projectId, payload, { excludeUserId: actorId });
}
