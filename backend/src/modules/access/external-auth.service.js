import { ROLE_IDS, EXTERNAL_ROLES, hasRole, isSuperAdmin, isExternalUser, getUserRoles, pickPrimaryRole } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import AccessAssignment from './accessAssignment.model.js';
import User from '../users/user.model.js';
import Project from '../projects/project.model.js';

export const COMPANY_WIDE_AUTO_ASSIGN_REASON = 'company_wide_auto_assign';

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
  }).populate('user', 'name email role roles status').lean();

  const byUser = new Map();
  for (const row of assignments) {
    const user = row.user;
    if (!user || user.status !== 'active' || isSuperAdmin(user)) continue;
    const userId = String(user._id ?? user.id);

    const entry = byUser.get(userId) ?? {
      userId,
      name: user.name,
      email: user.email,
      role: pickPrimaryRole(getUserRoles(user)),
      roles: getUserRoles(user),
      hasCompanyWide: false,
      hasProject: false,
    };
    if (row.project) entry.hasProject = true;
    else entry.hasCompanyWide = true;
    byUser.set(userId, entry);
  }

  return [...byUser.values()].map((entry) => {
    const scopeType = entry.hasCompanyWide ? 'company' : 'project';
    return {
      userId: entry.userId,
      name: entry.name,
      email: entry.email,
      role: entry.role,
      scopeType,
      scopeLabel: scopeType === 'company' ? 'Company-wide' : 'This project',
      effectiveStatus: 'effective',
    };
  });
}

/** Company ids an external user may access from active AccessAssignment rows. */
export async function permittedClientIdsForExternalUser(userId) {
  const assignments = await AccessAssignment.find({
    user: userId,
    status: 'active',
    client: { $ne: null },
  }).select('client').lean();

  return [...new Set(assignments.map((row) => String(row.client)))];
}

/** Whether an external user has any active company/project assignment. */
export async function hasExternalWorkspaceAccess(userId) {
  const count = await AccessAssignment.countDocuments({ user: userId, status: 'active' });
  return count > 0;
}

/**
 * Enforce that an external user may access a project via AccessAssignment.
 * Internal users are not checked here — their authorization is elsewhere.
 */
export async function assertExternalProjectAccess(actor, projectId) {
  if (!isExternalUser(actor)) return;

  const project = await Project.findById(projectId).select('client status').lean();
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  if (project.status !== 'active' || !project.client) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this project');
  }

  if (!await externalUserCoversProject(actor._id, project.client, projectId)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this project');
  }
}

/** External users may raise tickets only within their assigned company/project scope. */
export async function assertExternalCanCreateTicket(actor, projectId) {
  if (!isExternalUser(actor)) return;
  await assertExternalProjectAccess(actor, projectId);
}

/** Project ids an external user may access from AccessAssignment union. */
export async function permittedProjectIdsForExternalUser(userId) {
  const assignments = await AccessAssignment.find({ user: userId, status: 'active' })
    .select('client project').lean();

  const projectIdSet = new Set();
  for (const row of assignments) {
    if (row.project) {
      projectIdSet.add(String(row.project));
    } else if (row.client) {
      const ids = await Project.find({ client: row.client, status: 'active' }).distinct('_id');
      for (const id of ids) projectIdSet.add(String(id));
    }
  }
  return [...projectIdSet];
}

async function projectScopeFromAssignments(assignments) {
  const clauses = [];
  for (const row of assignments) {
    if (row.project) {
      clauses.push({ project: row.project });
    } else if (row.client) {
      const ids = await Project.find({ client: row.client, status: 'active' }).distinct('_id');
      if (ids.length) clauses.push({ project: { $in: ids } });
    }
  }
  if (!clauses.length) return { _id: null };
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

async function clientTesterIdsInClientBoundary(clientIds) {
  if (!clientIds.length) return [];
  const userIds = await AccessAssignment.find({
    client: { $in: clientIds },
    status: 'active',
    role: ROLE_IDS.CLIENT_TESTER,
  }).distinct('user');
  const active = await User.find({
    _id: { $in: userIds },
    role: ROLE_IDS.CLIENT_TESTER,
    status: 'active',
  }).distinct('_id');
  return active;
}

/** Mongo filter restricting list/search to externally visible tickets. */
export async function buildExternalTicketFilter(actor) {
  const assignments = await AccessAssignment.find({
    user: actor._id,
    status: 'active',
  }).select('client project').lean();

  if (!assignments.length) return { _id: null };

  const projectScope = await projectScopeFromAssignments(assignments);

  if (hasRole(actor, ROLE_IDS.CLIENT_TESTER)) {
    return { $and: [projectScope, { createdBy: actor._id }] };
  }

  const clientIds = [...new Set(
    assignments.filter((row) => row.client).map((row) => String(row.client)),
  )];
  const eligibleCreators = await clientTesterIdsInClientBoundary(clientIds);
  if (!eligibleCreators.length) return { _id: null };

  return {
    $and: [
      projectScope,
      { createdBy: { $in: eligibleCreators } },
    ],
  };
}

async function creatorCoversClientBoundary(creatorId, clientId, projectId) {
  const rows = await AccessAssignment.find({
    user: creatorId,
    client: clientId,
    status: 'active',
    role: ROLE_IDS.CLIENT_TESTER,
    $or: [{ project: null }, { project: projectId }],
  }).limit(1).lean();
  return rows.length > 0;
}

/**
 * External ticket visibility: project in scope, ticket externally raised, user
 * assignment covers the project. Internal tickets remain invisible.
 */
export async function canExternalViewTicket(actor, ticket) {
  if (!isExternalUser(actor)) return false;

  const creator = await User.findById(ticket.createdBy).select('role roles').lean();
  if (!hasRole(creator, ROLE_IDS.CLIENT_TESTER)) return false;

  const projectId = ticket.project?._id ?? ticket.project;
  if (!projectId) return false;

  let clientId = ticket.project?.client ?? null;
  if (!clientId) {
    const project = await Project.findById(projectId).select('client').lean();
    clientId = project?.client;
  }
  if (!clientId) return false;

  if (!await externalUserCoversProject(actor._id, clientId, projectId)) return false;

  const creatorId = ticket.createdBy?._id ?? ticket.createdBy;

  if (hasRole(actor, ROLE_IDS.CLIENT_TESTER)) {
    return String(creatorId) === String(actor._id);
  }

  return creatorCoversClientBoundary(creatorId, clientId, projectId);
}

/** Strip internal-only ticket fields for external API responses. */
export function sanitizeExternalTicket(ticketJson) {
  const {
    comments,
    activityLog,
    stageHistory,
    watchers,
    testedBy,
    ...rest
  } = ticketJson;

  const createdBy = rest.createdBy
    ? {
      id: rest.createdBy.id ?? rest.createdBy._id,
      name: rest.createdBy.name,
    }
    : rest.createdBy;

  const assignedTo = rest.assignedTo
    ? {
      id: rest.assignedTo.id ?? rest.assignedTo._id,
      name: rest.assignedTo.name,
    }
    : null;

  const team = rest.team
    ? {
      id: rest.team.id ?? rest.team._id,
      name: rest.team.name,
    }
    : null;

  return {
    ...rest,
    createdBy,
    assignedTo,
    testedBy: null,
    team,
    watchers: [],
    comments: [],
    activityLog: [],
    stageHistory: [],
  };
}

export async function getCompanyExternalAccess(clientId) {
  const rows = await AccessAssignment.find({
    client: clientId,
    project: null,
    status: 'active',
    role: { $in: [ROLE_IDS.CLIENT, ROLE_IDS.CLIENT_TESTER] },
  }).select('user role').lean();

  return {
    clientUserIds: rows
      .filter((row) => row.role === ROLE_IDS.CLIENT)
      .map((row) => String(row.user)),
    clientTesterIds: rows
      .filter((row) => row.role === ROLE_IDS.CLIENT_TESTER)
      .map((row) => String(row.user)),
  };
}

async function assertExternalUsers(userIds, expectedRole) {
  const desired = [...new Set((userIds || []).map(String))];
  if (!desired.length) return;

  const users = await User.find({ _id: { $in: desired } }).select('role roles status');
  if (users.length !== desired.length) {
    throw new ApiError(400, 'USER_NOT_FOUND', 'One or more users were not found');
  }
  for (const user of users) {
    if (user.status !== 'active') {
      throw new ApiError(400, 'USER_NOT_ACTIVE', 'Only active users can be assigned external access');
    }
    if (!hasRole(user, expectedRole)) {
      throw new ApiError(
        400,
        'INVALID_EXTERNAL_USER',
        `Only users with the ${expectedRole} role can be assigned here`,
      );
    }
  }
}

async function activeProjectIdsForClient(clientId) {
  return Project.find({ client: clientId, status: 'active' }).distinct('_id');
}

async function autoAssignCompanyWideTestersToProjects(actor, clientId, userIds, projectIds = null) {
  const testerIds = [...new Set((userIds || []).map(String))];
  if (!testerIds.length) return;

  const targets = projectIds ?? await activeProjectIdsForClient(clientId);
  if (!targets.length) return;

  const existing = await AccessAssignment.find({
    user: { $in: testerIds },
    client: clientId,
    project: { $in: targets },
    role: ROLE_IDS.CLIENT_TESTER,
    status: 'active',
  }).select('user project').lean();

  const existingKeys = new Set(
    existing.map((row) => `${row.user}:${row.project}`),
  );

  const toCreate = [];
  for (const userId of testerIds) {
    for (const projectId of targets) {
      const key = `${userId}:${projectId}`;
      if (existingKeys.has(key)) continue;
      toCreate.push({
        user: userId,
        role: ROLE_IDS.CLIENT_TESTER,
        client: clientId,
        project: projectId,
        grantedBy: actor._id,
        reason: COMPANY_WIDE_AUTO_ASSIGN_REASON,
      });
    }
  }

  if (toCreate.length) {
    await AccessAssignment.insertMany(toCreate);
  }
}

async function revokeAutoAssignedProjectTesters(clientId, userIds) {
  const testerIds = [...new Set((userIds || []).map(String))];
  if (!testerIds.length) return;

  await AccessAssignment.updateMany(
    {
      user: { $in: testerIds },
      client: clientId,
      project: { $ne: null },
      role: ROLE_IDS.CLIENT_TESTER,
      status: 'active',
      reason: COMPANY_WIDE_AUTO_ASSIGN_REASON,
    },
    {
      $set: {
        status: 'revoked',
        reason: 'company_external_access_updated',
      },
    },
  );
}

/** Auto-assign all company-wide client testers to a single new project. */
export async function assignCompanyWideClientTestersToProject(actor, clientId, projectId) {
  const companyWideTesters = await AccessAssignment.find({
    client: clientId,
    project: null,
    role: ROLE_IDS.CLIENT_TESTER,
    status: 'active',
  }).distinct('user');

  if (!companyWideTesters.length) return;

  await autoAssignCompanyWideTestersToProjects(
    actor,
    clientId,
    companyWideTesters.map(String),
    [projectId],
  );
}

async function syncCompanyRoleAssignments(actor, clientId, role, userIds) {
  const desired = [...new Set((userIds || []).map(String))];
  await assertExternalUsers(desired, role);

  const existing = await AccessAssignment.find({
    client: clientId,
    project: null,
    role,
    status: 'active',
  });

  const desiredSet = new Set(desired);
  const removedUserIds = [];
  for (const row of existing) {
    const userId = String(row.user);
    if (!desiredSet.has(userId)) {
      row.status = 'revoked';
      row.reason = 'company_external_access_updated';
      await row.save();
      removedUserIds.push(userId);
    }
  }

  const existingUsers = new Set(existing.map((row) => String(row.user)));
  const addedUserIds = [];
  for (const userId of desired) {
    if (existingUsers.has(userId)) continue;
    await AccessAssignment.create({
      user: userId,
      role,
      client: clientId,
      project: null,
      grantedBy: actor._id,
    });
    addedUserIds.push(userId);
  }

  if (role === ROLE_IDS.CLIENT_TESTER) {
    if (removedUserIds.length) {
      await revokeAutoAssignedProjectTesters(clientId, removedUserIds);
    }
    if (addedUserIds.length) {
      await autoAssignCompanyWideTestersToProjects(actor, clientId, addedUserIds);
    }
  }
}

export async function syncCompanyExternalAccess(actor, clientId, { clientUserIds, clientTesterIds } = {}) {
  if (clientUserIds !== undefined) {
    await syncCompanyRoleAssignments(actor, clientId, ROLE_IDS.CLIENT, clientUserIds);
  }
  if (clientTesterIds !== undefined) {
    await syncCompanyRoleAssignments(actor, clientId, ROLE_IDS.CLIENT_TESTER, clientTesterIds);
  }
  return getCompanyExternalAccess(clientId);
}
