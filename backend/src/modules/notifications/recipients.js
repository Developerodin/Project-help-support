import { DEFAULT_NOTIFICATION_PREFS, ROLE_IDS } from '@pms/shared';
import User from '../users/user.model.js';
import Team from '../teams/team.model.js';
import Project from '../projects/project.model.js';

/** Stages whose entry broadcasts to every qa user. */
const QA_BROADCAST_STAGES = new Set(['ready_qa', 'deployed_staging', 'qa_approved']);
/** Stages whose entry broadcasts to every lead and admin. */
const RELEASE_BROADCAST_STAGES = new Set(['ready_production', 'live']);

const idStr = (v) => (v ? String(v._id ?? v) : null);

async function addTeamMembers(ids, teamId) {
  const team = await Team.findById(teamId).select('members lead');
  for (const m of team?.members || []) ids.add(idStr(m));
  if (team?.lead) ids.add(idStr(team.lead));
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
    // Mentions NEVER union the comment audience — otherwise mentioning one
    // person notifies the whole ticket twice.
    for (const id of context.mentions || []) ids.add(idStr(id));
  } else {
    ids.add(idStr(ticket.createdBy));
    for (const w of ticket.watchers || []) ids.add(idStr(w));
    if (ticket.assignedTo) ids.add(idStr(ticket.assignedTo));
    if (ticket.testedBy) ids.add(idStr(ticket.testedBy));

    if (ticket.team) {
      await addTeamMembers(ids, ticket.team);
    } else if (ticket.project) {
      // No team of its own — fall back to the project's assigned team, same
      // fallback as ticket visibility (ticket.service.js#applyTicketVisibility).
      const projectId = ticket.project?._id ?? ticket.project;
      const project = await Project.findById(projectId).select('team').lean();
      if (project?.team) await addTeamMembers(ids, project.team);
    }

    const { to } = context;
    if (to && QA_BROADCAST_STAGES.has(to)) {
      const testers = await User.find({ role: ROLE_IDS.TESTER, status: 'active' }).select('_id');
      for (const u of testers) ids.add(idStr(u._id));
    }
    if (to && RELEASE_BROADCAST_STAGES.has(to)) {
      const leads = await User.find({
        role: { $in: [ROLE_IDS.PROJECT_ADMIN, ROLE_IDS.ADMIN, ROLE_IDS.SUPER_ADMIN] }, status: 'active',
      }).select('_id');
      for (const u of leads) ids.add(idStr(u._id));
    }
  }

  ids.delete(idStr(actor?._id));
  ids.delete(null);

  if (ids.size === 0) return [];

  const users = await User.find({ _id: { $in: [...ids] }, status: 'active' });

  return users.map((user) => ({
    user,
    channels: {
      inApp: resolvePreference(user, 'inApp', event),
      email: resolvePreference(user, 'email', event),
    },
  }));
}
