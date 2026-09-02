import {
  ROLE_IDS,
  EXTERNAL_ROLES,
  hasRole,
  isSuperAdmin,
  isExternalUser,
  getUserRoles,
  pickPrimaryRole,
} from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import AccessAssignment from './accessAssignment.model.js';
import {
  activeNotExpiredFilter,
  revokeExpiredActiveDuplicates,
} from './accessAssignment.queries.js';
import User from '../users/user.model.js';
import Project from '../projects/project.model.js';

export const COMPANY_WIDE_AUTO_ASSIGN_REASON = 'company_wide_auto_assign';

export { activeNotExpiredFilter } from './accessAssignment.queries.js';

export function isExternalRole(role) {
  return EXTERNAL_ROLES.includes(role);
}

/**
 * Returns active AccessAssignment rows for an external user, optionally scoped
 * to a client and/or project.
 */
export async function activeAssignmentsForUser(userId, { clientId = null, projectId = null } = {}) {
  const criteria = { user: userId };
  if (clientId) criteria.client = clientId;
  if (projectId) criteria.project = projectId;
  return AccessAssignment.find(activeNotExpiredFilter(criteria)).lean();
}

/**
 * Whether an external user has assignment coverage for a project within a client.
 * Client → company scope; client_tester → project scope when any project row exists.
 */
export async function externalUserCoversProject(userId, clientId, projectId) {
  const user = await User.findById(userId).select('role roles').lean();
  if (!user) return false;

  const assignments = await AccessAssignment.find(activeNotExpiredFilter({ user: userId }))
    .select('role client project').lean();
  const visibleProjectIds = await resolveTicketProjectScope(user, assignments);
  if (!visibleProjectIds) return false;

  const projectIdStr = String(projectId);
  if (!visibleProjectIds.includes(projectIdStr)) return false;

  const project = await Project.findById(projectId).select('client').lean();
  return project?.client && String(project.client) === String(clientId);
}

/**
 * Effective client testers for a project from AccessAssignment — single source
 * of truth. Super Admin users are never included.
 */
export async function listEffectiveClientTesters(projectId, clientId) {
  const assignments = await AccessAssignment.find(activeNotExpiredFilter({
    client: clientId,
    role: ROLE_IDS.CLIENT_TESTER,
    $or: [{ project: null }, { project: projectId }],
  })).populate('user', 'name email role roles status').lean();

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
  const assignments = await AccessAssignment.find(activeNotExpiredFilter({
    user: userId,
    client: { $ne: null },
  })).select('client').lean();

  return [...new Set(assignments.map((row) => String(row.client)))];
}

/** Whether an external user has any active company/project assignment. */
export async function hasExternalWorkspaceAccess(userId) {
  const count = await AccessAssignment.countDocuments(activeNotExpiredFilter({ user: userId }));
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
  const user = await User.findById(userId).select('role roles').lean();
  if (!user) return [];

  const assignments = await AccessAssignment.find(activeNotExpiredFilter({ user: userId }))
    .select('role client project').lean();
  const projectIds = await resolveTicketProjectScope(user, assignments);
  return projectIds ?? [];
}

/**
 * Resolve authorized ticket project ids for external roles.
 * Client → all active projects under assigned companies.
 * Client tester → explicit project rows plus every active project for each
 * company-wide assignment (project: null). Project-only rows never expand to
 * sibling projects in the same company.
 */
async function resolveTicketProjectScope(actor, assignments) {
  if (!assignments.length) return null;

  if (hasRole(actor, ROLE_IDS.CLIENT)) {
    const clientIds = [...new Set(
      assignments
        .filter((row) => row.role === ROLE_IDS.CLIENT && row.client)
        .map((row) => String(row.client)),
    )];
    if (!clientIds.length) return null;

    const ids = await Project.find({ client: { $in: clientIds }, status: 'active' }).distinct('_id');
    return ids.length ? ids.map(String) : null;
  }

  if (hasRole(actor, ROLE_IDS.CLIENT_TESTER)) {
    const testerRows = assignments.filter((row) => row.role === ROLE_IDS.CLIENT_TESTER);
    if (!testerRows.length) return null;

    const projectIds = new Set(
      testerRows.filter((row) => row.project).map((row) => String(row.project)),
    );

    const companyWideClientIds = [...new Set(
      testerRows.filter((row) => row.client && !row.project).map((row) => String(row.client)),
    )];
    if (companyWideClientIds.length) {
      const ids = await Project.find({
        client: { $in: companyWideClientIds },
        status: 'active',
      }).distinct('_id');
      for (const id of ids) projectIds.add(String(id));
    }

    return projectIds.size ? [...projectIds] : null;
  }

  return null;
}

/**
 * Mongo filter restricting list/search to externally visible tickets.
 *
 * Visibility matrix:
 * - `client`: all tickets in assigned company projects (Ticket → Project → Company).
 * - `client_tester`: tickets in assigned project(s), or all company projects when
 *   only company-wide assignment exists (no project rows).
 */
export async function buildExternalTicketFilter(actor) {
  const assignments = await AccessAssignment.find(activeNotExpiredFilter({ user: actor._id }))
    .select('role client project').lean();

  const projectIds = await resolveTicketProjectScope(actor, assignments);
  if (!projectIds?.length) return { _id: null };

  return { project: { $in: projectIds } };
}

/**
 * External ticket visibility: assignment scope via Ticket → Project → Company.
 * Field-level stripping is sanitizeExternalTicket's job, not this one's.
 */
export async function canExternalViewTicket(actor, ticket) {
  if (!isExternalUser(actor)) return false;

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

/** Validate scoped grants to external roles target users with matching global roles. */
export async function assertExternalRoleTarget(user, expectedRole) {
  if (!isExternalRole(expectedRole)) return;
  if (!user || user.status !== 'active') {
    throw new ApiError(400, 'USER_NOT_ACTIVE', 'Only active users can receive scoped external access');
  }
  if (!hasRole(user, expectedRole)) {
    throw new ApiError(
      400,
      'INVALID_EXTERNAL_USER',
      `Only users with the ${expectedRole} role can be assigned here`,
    );
  }
}

/** Company-wide client_tester grants inherit to every active project in the company. */
export async function propagateCompanyWideClientTesterGrant(actor, clientId, userId) {
  await autoAssignCompanyWideTestersToProjects(actor, clientId, [String(userId)]);
}

/** Revoke auto-inherited project rows when company-wide client_tester access is removed. */
export async function propagateCompanyWideClientTesterRevoke(clientId, userId) {
  await revokeAutoAssignedProjectTesters(clientId, [String(userId)]);
}

/**
 * Revoke project-specific external assignments when a project moves companies.
 * Company-wide rows for the old client are left untouched — they stop applying
 * naturally once Project.client changes.
 */
export async function revokeProjectExternalAssignmentsOnClientChange(projectId, oldClientId) {
  await AccessAssignment.updateMany(
    {
      client: oldClientId,
      project: projectId,
      role: { $in: [ROLE_IDS.CLIENT, ROLE_IDS.CLIENT_TESTER] },
      status: 'active',
    },
    {
      $set: {
        status: 'revoked',
        reason: 'project_client_changed',
      },
    },
  );
}

/** Stage moves come from stageHistory; every other action describes internal handling. */
const CLIENT_VISIBLE_ACTIONS = new Set(['created']);

function pickPerson(person) {
  if (!person) return null;
  if (typeof person.toJSON === 'function') {
    person = person.toJSON();
  }
  const rawId = person._id ?? person.id;
  if (rawId == null) return { name: person.name ?? null };
  const id = String(rawId);
  if (!id || id === 'undefined') return { name: person.name ?? null };
  return { id, name: person.name ?? null };
}

function publicAttachment(attachment) {
  // Drops `key` (storage key), `uploadedBy` (internal staff id), and `clientRef`
  // (internal dedupe token) — none belong in an external response.
  return {
    id: String(attachment._id ?? attachment.id),
    name: attachment.name,
    size: attachment.size,
    mimeType: attachment.mimeType,
    uploadedAt: attachment.uploadedAt,
  };
}

function publicComment(comment) {
  const author = comment.commentedBy;
  const person = pickPerson(author);
  return {
    id: comment.id ?? comment._id,
    content: comment.content,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt ?? null,
    attachments: (comment.attachments ?? []).map(publicAttachment),
    commentedBy: person
      ? { ...person, external: isExternalUser(author) }
      : null,
  };
}

function publicStageEntry(entry) {
  // `note`, `decision` and `attachments` carry close reasons and QA rejection
  // reports — internal judgements about the client's own ticket.
  return {
    id: entry.id ?? entry._id,
    from: entry.from ?? null,
    to: entry.to,
    at: entry.at,
    by: pickPerson(entry.by),
  };
}

const attachmentId = (a) => String(a._id ?? a.id);

/**
 * Ids of attachments that only internal viewers may see — collected from the
 * RAW arrays, before they are filtered down to the public set. A ticket-level
 * attachment sharing one of these ids must not appear in the external
 * attachments list either, even though the ticket-level array itself carries
 * no `internal` flag.
 *
 * Two sources: `internal: true` comments, and stage-history evidence (the QA
 * report screenshot), which is internal for the same reason `note` is.
 */
function internalAttachmentIds(comments, stageHistory) {
  const ids = new Set();
  for (const comment of comments || []) {
    if (comment.internal !== true) continue;
    for (const attachment of comment.attachments || []) {
      ids.add(attachmentId(attachment));
    }
  }
  for (const entry of stageHistory || []) {
    for (const attachment of entry.attachments || []) {
      ids.add(attachmentId(attachment));
    }
  }
  return ids;
}

/**
 * External responses never expose other watchers (often internal staff).
 * When `viewerId` is supplied, include only that viewer if they are watching —
 * enough for the Watch toggle without leaking the rest of the list.
 */
function selfOnlyWatchers(watchers, viewerId) {
  if (!viewerId) return [];
  const viewer = String(viewerId);
  const match = (watchers || []).find((w) => String(w?._id ?? w?.id ?? w) === viewer);
  if (!match) return [];

  // Populated / lean person docs: prefer `_id`, then a string `id`. Bare
  // ObjectId refs expose a misleading `.id` buffer getter — do not use that.
  if (match && typeof match === 'object') {
    const id = match._id ?? (typeof match.id === 'string' ? match.id : null);
    if (id != null || typeof match.name === 'string') {
      return [{ id: String(id ?? viewer), name: match.name ?? null }];
    }
  }

  return [{ id: viewer, name: null }];
}

/** Strip internal-only ticket fields for external API responses. */
export function sanitizeExternalTicket(ticketJson, { viewerId } = {}) {
  const {
    comments,
    activityLog,
    stageHistory,
    watchers,
    testedBy,
    attachments,
    // `blocked`/`blockedAt` stay — "this is blocked, since Tuesday" is status the
    // client is entitled to. The REASON is an internal triage note and `blockedBy`
    // is an internal staff id; neither is populated anywhere, so it would ship raw.
    blockerReason,
    blockedBy,
    ...rest
  } = ticketJson;
  void blockerReason;
  void blockedBy;

  const hiddenAttachmentIds = internalAttachmentIds(comments, stageHistory);
  const visibleAttachments = (attachments || [])
    .filter((a) => !hiddenAttachmentIds.has(attachmentId(a)))
    .map(publicAttachment);

  return {
    ...rest,
    createdBy: pickPerson(rest.createdBy),
    assignedTo: pickPerson(rest.assignedTo),
    testedBy: null,
    team: pickPerson(rest.team),
    watchers: selfOnlyWatchers(watchers, viewerId),
    attachments: visibleAttachments,
    comments: (comments || []).filter((c) => c.internal !== true).map(publicComment),
    activityLog: (activityLog || [])
      .filter((entry) => CLIENT_VISIBLE_ACTIONS.has(entry.action))
      .map((entry) => ({
        id: entry.id ?? entry._id,
        action: entry.action,
        at: entry.at,
        performedBy: pickPerson(entry.performedBy),
        changes: [],
      })),
    stageHistory: (stageHistory || []).map(publicStageEntry),
  };
}

export async function getCompanyExternalAccess(clientId) {
  const rows = await AccessAssignment.find(activeNotExpiredFilter({
    client: clientId,
    project: null,
    role: { $in: [ROLE_IDS.CLIENT, ROLE_IDS.CLIENT_TESTER] },
  })).select('user role').lean();

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

  const existing = await AccessAssignment.find(activeNotExpiredFilter({
    user: { $in: testerIds },
    client: clientId,
    project: { $in: targets },
    role: ROLE_IDS.CLIENT_TESTER,
  })).select('user project').lean();

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
    for (const row of toCreate) {
      await revokeExpiredActiveDuplicates({
        userId: row.user,
        role: row.role,
        clientId: row.client,
        projectId: row.project,
      });
    }
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
  const companyWideTesters = await AccessAssignment.find(activeNotExpiredFilter({
    client: clientId,
    project: null,
    role: ROLE_IDS.CLIENT_TESTER,
  })).distinct('user');

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

  const existing = await AccessAssignment.find(activeNotExpiredFilter({
    client: clientId,
    project: null,
    role,
  }));

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
    await revokeExpiredActiveDuplicates({
      userId,
      role,
      clientId,
      projectId: null,
    });
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
