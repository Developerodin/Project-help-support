import { ROLE_IDS, EXTERNAL_ROLES } from '@pms/shared';
import AccessAssignment from './accessAssignment.model.js';
import User from '../users/user.model.js';
import Project from '../projects/project.model.js';

export function isExternalRole(role) {
  return EXTERNAL_ROLES.includes(role);
}

/**
 * Returns active AccessAssignment rows for an external user, optionally scoped
 * to a client and/or project.
 */
export async function activeAssignmentsForUser(userId, { clientId = null, projectId = null } = {}) {
  const filter = { user: userId, status: 'active' };
  if (clientId) filter.client = clientId;
  if (projectId) filter.project = projectId;
  return AccessAssignment.find(filter).lean();
}

/**
 * Whether an external user has assignment coverage for a project within a client.
 */
export async function externalUserCoversProject(userId, clientId, projectId) {
  const rows = await AccessAssignment.find({
    user: userId,
    client: clientId,
    status: 'active',
    $or: [{ project: null }, { project: projectId }],
  }).lean();
  return rows.length > 0;
}

/**
 * Effective client testers for a project from AccessAssignment — single source
 * of truth. Super Admin users are never included.
 */
export async function listEffectiveClientTesters(projectId, clientId) {
  const assignments = await AccessAssignment.find({
    client: clientId,
    status: 'active',
    role: ROLE_IDS.CLIENT_TESTER,
    $or: [{ project: null }, { project: projectId }],
  }).populate('user', 'name email role status').lean();

  const seen = new Map();
  for (const row of assignments) {
    const user = row.user;
    if (!user || user.status !== 'active' || user.role === ROLE_IDS.SUPER_ADMIN) continue;
    const userId = String(user._id ?? user.id);
    if (seen.has(userId)) continue;

    const scopeType = row.project ? 'project' : 'company';
    seen.set(userId, {
      userId,
      name: user.name,
      email: user.email,
      role: user.role,
      scopeType,
      scopeLabel: scopeType === 'company' ? 'Company-wide' : 'This project',
      effectiveStatus: 'effective',
    });
  }

  return [...seen.values()];
}

/** Mongo filter restricting list/search to externally raised tickets in external scope. */
export async function buildExternalTicketFilter(actor) {
  const assignments = await AccessAssignment.find({
    user: actor._id, status: 'active',
  }).select('client project').lean();

  const projectIdSet = new Set();
  for (const row of assignments) {
    if (row.project) projectIdSet.add(String(row.project));
    else if (row.client) {
      const ids = await Project.find({ client: row.client, status: 'active' }).distinct('_id');
      for (const id of ids) projectIdSet.add(String(id));
    }
  }

  const clientTesterIds = await User.find({
    role: ROLE_IDS.CLIENT_TESTER, status: 'active',
  }).distinct('_id');

  return {
    project: { $in: [...projectIdSet] },
    createdBy: { $in: clientTesterIds },
  };
}

/**
 * External ticket visibility: project in scope, ticket externally raised, user
 * assignment covers the project. Internal tickets remain invisible.
 */
export async function canExternalViewTicket(actor, ticket) {
  if (!isExternalRole(actor.role)) return false;

  const creator = await User.findById(ticket.createdBy).select('role').lean();
  if (creator?.role !== ROLE_IDS.CLIENT_TESTER) return false;

  const projectId = ticket.project?._id ?? ticket.project;
  if (!projectId) return false;

  let clientId = ticket.project?.client ?? null;
  if (!clientId) {
    const project = await Project.findById(projectId).select('client').lean();
    clientId = project?.client;
  }
  if (!clientId) return false;

  return externalUserCoversProject(actor._id, clientId, projectId);
}
