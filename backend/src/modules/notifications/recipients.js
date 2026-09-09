import { DEFAULT_NOTIFICATION_PREFS, ROLE_IDS, isExternalUser } from '@pms/shared';
import AccessAssignment from '../access/accessAssignment.model.js';
import { activeNotExpiredFilter, canExternalViewTicket } from '../access/external-auth.service.js';
import Team from '../teams/team.model.js';
import Project from '../projects/project.model.js';
import User from '../users/user.model.js';
import ProjectTeamMember from '../projects/project-team-member.model.js';

/** Stages whose entry broadcasts to every qa user. */
const QA_BROADCAST_STAGES = new Set(['ready_qa', 'deployed_staging', 'qa_approved']);
/** Stages whose entry broadcasts to every lead and admin. */
const RELEASE_BROADCAST_STAGES = new Set(['ready_production', 'live']);
/** Only stage-change events should evaluate stage-entry broadcasts. */
const STAGE_ENTRY_EVENTS = new Set(['TICKET_STAGE_CHANGED', 'TICKET_REOPENED', 'TICKET_CLOSED']);

const idStr = (v) => (v ? String(v._id ?? v) : null);

async function addTeamMembers(ids, teamId) {
  const team = await Team.findById(teamId).select('members lead');
  for (const m of team?.members || []) ids.add(idStr(m));
  if (team?.lead) ids.add(idStr(team.lead));
}

async function addProjectTeamRoleMembers(ids, ticket, role) {
  const projectId = idStr(ticket.project);
  if (!projectId) return;

  const ticketTeamId = idStr(ticket.team);
  const projectTeamId = ticketTeamId
    ? ticketTeamId
    : idStr((await Project.findById(projectId).select('team').lean())?.team);
  if (!projectTeamId) return;

  const rows = await ProjectTeamMember.find({
    project: projectId,
    team: projectTeamId,
    role,
  }).select('user').lean();
  for (const row of rows) ids.add(idStr(row.user));
}

async function ticketScopeIds(ticket) {
  const projectId = idStr(ticket?.project);
  if (!projectId) return { projectId: null, clientId: null };

  const embeddedClientId = idStr(ticket?.project?.client);
  if (embeddedClientId) return { projectId, clientId: embeddedClientId };

  const project = await Project.findById(projectId).select('client').lean();
  return { projectId, clientId: idStr(project?.client) };
}

async function externallyAssignedForClient(users, clientId) {
  if (!clientId || users.length === 0) return new Set();

  const userIds = users.map((user) => user._id);
  const rows = await AccessAssignment.find(activeNotExpiredFilter({
    user: { $in: userIds },
    client: clientId,
    role: { $in: [ROLE_IDS.CLIENT, ROLE_IDS.CLIENT_TESTER] },
  })).select('user').lean();

  return new Set(rows.map((row) => idStr(row.user)).filter(Boolean));
}

async function filterVisibleUsersForTicket(users, ticket) {
  const externalUsers = users.filter((user) => isExternalUser(user));
  const scope = externalUsers.length > 0 ? await ticketScopeIds(ticket) : null;
  const allowedExternalByBrand = externalUsers.length > 0
    ? await externallyAssignedForClient(externalUsers, scope?.clientId ?? null)
    : new Set();

  const visible = [];
  for (const user of users) {
    if (!isExternalUser(user)) {
      visible.push(user);
      continue;
    }

    if (!scope?.projectId || !scope?.clientId) {
      continue;
    }
    if (!allowedExternalByBrand.has(idStr(user._id))) {
      continue;
    }
    if (await canExternalViewTicket(user, ticket)) {
      visible.push(user);
    }
  }
  return visible;
}

function mentionIdsFromContext(context = {}) {
  if (!Array.isArray(context.mentions)) return [];

  const ids = new Set();
  for (const mention of context.mentions) {
    const resolved = idStr(mention);
    if (resolved) ids.add(resolved);
  }
  return [...ids];
}

/**
 * An unset preference resolves through the DEFAULTS table — never to `true`.
 * Resolving to true unconditionally is exactly Dharwin's current behaviour, and
 * the reason opt-outs there are silently ignored.
 */
export function resolvePreference(user, channel, event) {
  const stored = user.notificationPrefs?.[channel]?.get?.(event);
  if (typeof stored === 'boolean') return stored;
  return DEFAULT_NOTIFICATION_PREFS[channel][event] ?? false;
}

/**
 * THE recipient resolver. Both channels read from this one function, because
 * duplicating the calculation per channel is how in-app and email diverge.
 *
 * Order matters: build the union, drop the actor, dedupe by user id, then apply
 * per-channel preferences. A person matching five rules gets one entry.
 */
export async function getNotificationRecipients(event, ticket, actor, context = {}) {
  const ids = new Set();
  if (event === 'TICKET_MENTIONED') {
    for (const mentionId of mentionIdsFromContext(context)) ids.add(mentionId);
  } else {
    ids.add(idStr(ticket.createdBy));
    for (const w of ticket.watchers || []) ids.add(idStr(w));
    if (ticket.assignedTo) ids.add(idStr(ticket.assignedTo));
    if (ticket.testedBy) ids.add(idStr(ticket.testedBy));

    if (idStr(ticket.team)) {
      await addTeamMembers(ids, ticket.team);
    }

    const { to } = context;
    if (to && STAGE_ENTRY_EVENTS.has(event) && QA_BROADCAST_STAGES.has(to)) {
      await addProjectTeamRoleMembers(ids, ticket, 'qa');
    }
    if (to && STAGE_ENTRY_EVENTS.has(event) && RELEASE_BROADCAST_STAGES.has(to)) {
      await addProjectTeamRoleMembers(ids, ticket, 'team_lead');
    }
  }

  ids.delete(idStr(actor?._id));
  ids.delete(null);

  if (ids.size === 0) return [];

  const users = await User.find({ _id: { $in: [...ids] }, status: 'active' });
  const visibleUsers = await filterVisibleUsersForTicket(users, ticket);

  return visibleUsers.map((user) => ({
    user,
    channels: {
      inApp: resolvePreference(user, 'inApp', event),
      email: resolvePreference(user, 'email', event),
    },
  }));
}
