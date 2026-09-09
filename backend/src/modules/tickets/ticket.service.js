import mongoose from 'mongoose';
import {
  resolveTicketEstimateDates,
  validateTicketEstimateDates,
  ticketDateKey,
  ROLE_IDS,
  ADMIN_ROLES,
  ESTIMATE_DATE_EDITOR_ROLES,
  can,
  hasAnyRole,
  isPureExternalActor,
  hasActiveScopedConstraints,
  canInScope,
} from '@pms/shared';
import { canExternalViewTicket, buildExternalTicketFilter, sanitizeExternalTicket, assertExternalCanCreateTicket } from '../access/external-auth.service.js';
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import Project from '../projects/project.model.js';
import { assertModuleAndPage } from '../projects/project.service.js';
import {
  assertAssigneeOnProjectTeam,
  ensureProjectMigrated,
  findProjectMemberByRole,
} from '../projects/project-team-member.service.js';
import Team from '../teams/team.model.js';
import { assertTeamUsable, assertActiveUsers } from '../teams/team.service.js';
import {
  assertScopedPermissionWhenConstrained,
  ticketScopeTarget,
  resolvePermissionContext,
} from '../access/scope-enforcement.js';
import Ticket from './ticket.model.js';

const EXTERNAL_ACCESS_ASSIGNMENT_PERMISSIONS = new Set(['tickets.view', 'tickets.create']);

async function assertHasTicketPermission(actor, permission, permissionContext = null) {
  const ctx = await resolvePermissionContext(actor, permissionContext);
  // External visibility and filing are governed by AccessAssignment scope, not RBAC.
  if (isPureExternalActor(actor) && EXTERNAL_ACCESS_ASSIGNMENT_PERMISSIONS.has(permission)) return ctx;
  if (!can(actor, permission, ctx)) {
    throw new ApiError(403, 'FORBIDDEN', `Requires permission: ${permission}`);
  }
  return ctx;
}

export async function createTicket(actor, body, permissionContext = null) {
  await assertHasTicketPermission(actor, 'tickets.create', permissionContext);
  const project = await Project.findById(body.project);
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  if (project.status !== 'active') {
    throw new ApiError(400, 'PROJECT_ARCHIVED', 'That project is archived');
  }

  await assertExternalCanCreateTicket(actor, project._id);
  if (!isPureExternalActor(actor)) {
    await assertScopedPermissionWhenConstrained(
      actor,
      'tickets.create',
      { clientId: project.client, projectId: project._id, environment: body.environment ?? null },
      permissionContext,
    );
  }

  assertModuleAndPage(project, body.module, body.page);

  await ensureProjectMigrated(project._id);
  const projectTeamId = project.team || project.defaultTeam || undefined;
  const team = body.team ?? projectTeamId ?? undefined;

  let assignedTo = body.assignedTo ?? undefined;
  if (!assignedTo && team) {
    const lead = await findProjectMemberByRole(project._id, team, 'team_lead');
    if (lead) assignedTo = lead.user;
    else if (project.defaultAssignee) assignedTo = project.defaultAssignee;
  }

  let testedBy = body.testedBy ?? undefined;
  if (!testedBy) {
    testedBy = await resolveDefaultTester({
      project: project._id,
      team,
      testedBy: null,
    }, project);
  }

  await assertActiveUsers([assignedTo, testedBy]);
  if (team) await assertTeamUsable(team, project._id);
  if (assignedTo) await assertAssigneeOnProjectTeam(project._id, team, assignedTo);

  // Allocated LAST, after everything that can reject. A consumed sequence is
  // never returned, so validating first keeps the id space free of gaps caused
  // by ordinary user error. A gap from a crash after this line is acceptable.
  const { key, seq } = await Project.allocateTicketSeq(project._id);

  const now = new Date();
  const ticket = await Ticket.create({
    ticketId: `${key}-${seq}`,
    project: project._id,
    title: body.title,
    description: body.description,
    stepsToReproduce: body.stepsToReproduce,
    module: body.module,
    page: body.page,
    environment: body.environment,
    category: body.category,
    labels: body.labels || [],
    severity: body.severity,
    priority: body.priority,
    status: 'pending',
    assignedTo,
    testedBy,
    team,
    watchers: body.watchers || [],
    createdBy: actor._id,
    // The landing entry, so time-in-stage has a start for `pending` without
    // special-casing "the first stage has no history row".
    currentStageEnteredAt: now,
    stageHistory: [{ to: 'pending', by: actor._id, at: now }],
    activityLog: [{ action: 'created', performedBy: actor._id, at: now, changes: [] }],
  });

  return ticket.toJSON();
}

const DETAIL_POPULATE = [
  'project', 'assignedTo', 'testedBy', 'team', 'watchers', 'createdBy',
  'comments.commentedBy', 'comments.mentions', 'stageHistory.by', 'activityLog.performedBy',
];

/**
 * ticket.toJSON() can serialize nested populated users with an own `id` key set
 * to `undefined`, shadowing the Mongoose getter. Re-serialize from the source
 * documents so comment author ids survive for ownership checks in the client.
 */
function restoreNestedPopulatedUsers(ticketDoc, ticketJson) {
  const comments = ticketJson.comments || [];
  comments.forEach((commentJson, index) => {
    const author = ticketDoc.comments[index]?.commentedBy;
    if (author && typeof author.toJSON === 'function') {
      commentJson.commentedBy = author.toJSON();
    }
  });
}

const LIST_POPULATE = ['project', 'assignedTo', 'team', 'createdBy'];

/** QA stages that should have a tester assigned for visibility and notifications. */
export const QA_TESTER_STAGES = new Set(['ready_qa', 'deployed_staging', 'qa_approved']);

/**
 * Resolve the project QA tester — project-team `qa` role first, then legacy
 * defaultTester. Shared by createTicket and QA-lane transitions so a ticket
 * entering QA always grants view access to the assigned tester.
 */
export async function resolveDefaultTester(ticket, projectDoc = null) {
  if (ticket.testedBy) return null;

  const projectId = ticket.project?._id ?? ticket.project;
  if (!projectId) return null;

  await ensureProjectMigrated(projectId);

  const project = projectDoc
    ?? await Project.findById(projectId).select('team defaultTeam defaultTester').lean();

  const teamId = ticket.team?._id ?? ticket.team ?? project?.team ?? project?.defaultTeam;
  if (teamId) {
    const qaMember = await findProjectMemberByRole(projectId, teamId, 'qa');
    if (qaMember) return qaMember.user;
  }

  return project?.defaultTester ?? null;
}

/**
 * :id accepts EITHER the Mongo _id or the human ticketId (WEB-101), on every
 * ticket route. Deep links, email links and pasted ticket numbers all work
 * without the caller knowing which form it holds.
 */
export async function resolveTicketDoc(idOrKey, { populate = [], lean = false } = {}) {
  const filter = mongoose.isValidObjectId(idOrKey)
    ? { _id: idOrKey }
    : { ticketId: String(idOrKey).trim().toUpperCase() };

  let query = Ticket.findOne(filter);
  for (const path of populate) query = query.populate(path);
  if (lean) query = query.lean();

  const ticket = await query.exec();
  if (!ticket) throw new ApiError(404, 'TICKET_NOT_FOUND', 'Ticket not found');
  return ticket;
}

export async function getTicket(actor, idOrKey, permissionContext = null) {
  const ticket = await resolveTicketDoc(idOrKey, { populate: DETAIL_POPULATE });
  await assertCanViewTicket(actor, ticket, permissionContext);
  const json = ticket.toJSON();
  restoreNestedPopulatedUsers(ticket, json);
  return isPureExternalActor(actor) ? sanitizeExternalTicket(json, { viewerId: actor._id }) : json;
}

function scopeFilter(scope, actorId) {
  switch (scope) {
    case 'assigned': return { assignedTo: actorId };
    case 'reported': return { createdBy: actorId };
    case 'unassigned': return { assignedTo: null, team: null };
    default: return null;
  }
}

async function actorTeamIds(actorId) {
  return Team.find({
    status: 'active',
    $or: [{ members: actorId }, { lead: actorId }],
  }).distinct('_id');
}

/** Projects whose team is one of teamIds — a team-less ticket under one of these still belongs to the team. */
async function projectIdsForTeams(teamIds) {
  if (!teamIds.length) return [];
  return Project.find({ team: { $in: teamIds } }).distinct('_id');
}

/** Same audience as assertCanViewTicket / getNotificationRecipients (minus broadcast rules). */
function ticketVisibilityOr(actorId, teamIds = [], projectIds = []) {
  const clauses = [
    { createdBy: actorId },
    { assignedTo: actorId },
    { testedBy: actorId },
    { watchers: actorId },
  ];
  if (teamIds.length) clauses.push({ team: { $in: teamIds } });
  // Ticket has no team of its own — fall back to the project's team, so it
  // isn't invisible to everyone but its creator until someone triages it.
  if (projectIds.length) clauses.push({ team: null, project: { $in: projectIds } });
  return clauses;
}

/** Roles with unrestricted ticket list/detail visibility via the permission matrix. */
function hasGlobalTicketView(actor, permissionContext = null) {
  return can(actor, 'tickets.view', permissionContext)
    && hasAnyRole(actor, ...ADMIN_ROLES, ROLE_IDS.PROJECT_ADMIN);
}

async function applyTicketVisibility(filter, actor, permissionContext = null) {
  if (isPureExternalActor(actor)) {
    const externalFilter = await buildExternalTicketFilter(actor);
    if (Object.keys(filter).length === 0) return externalFilter;
    return { $and: [filter, externalFilter] };
  }

  if (hasGlobalTicketView(actor, permissionContext)) return filter;

  const teamIds = await actorTeamIds(actor._id);
  const projectIds = await projectIdsForTeams(teamIds);
  const visibility = { $or: ticketVisibilityOr(actor._id, teamIds, projectIds) };
  if (Object.keys(filter).length === 0) return visibility;
  return { $and: [filter, visibility] };
}

// "WEB-63", "web-63", "WEB63", "web 63", "63" — a project key is optional, and any
// run of spaces/hyphens/unicode dashes between key and number is noise.
const ID_SHAPE = /^([a-z]{2,10})?[\s\-\u2010-\u2015]*(\d{1,7})$/i;
const MAX_WORDS = 6;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The three fields the filter box advertises: number, title, module. Never
 * description — matching it is what made "Admin" return tickets with no
 * "Admin" anywhere the user could see.
 *
 * Returns a filter fragment to AND into the caller's filter, or null when
 * there is nothing to search for.
 *
 * ponytail: the word branch is an unanchored regex, so it is a collection
 * scan. Fine at this ticket volume; revisit around ~50k tickets, where the
 * upgrade is an Atlas Search `autocomplete` index. Do not reach for it early:
 * $search must be the first aggregation stage, which would push the RBAC
 * visibility filter to run after the match.
 */
export function ticketSearchClause(raw) {
  const term = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!term) return null;

  const id = term.match(ID_SHAPE);
  if (id) {
    // Anchored both ends: "63" means ticket 63, not 630. With a key it is
    // "^WEB-63$", a literal prefix the unique ticketId index can seek on.
    const key = id[1] ? `^${escapeRegex(id[1])}-` : '^[A-Za-z0-9]+-';
    return { ticketId: { $regex: `${key}${id[2]}$`, $options: 'i' } };
  }

  const words = term
    .split(' ')
    // A lone "-" typed against an en-dash title matches nothing useful, and an
    // all-punctuation term would otherwise match every ticket.
    .filter((word) => /[a-z0-9]/i.test(word))
    .slice(0, MAX_WORDS)
    .map(escapeRegex);
  if (!words.length) return null;

  // Every word must appear somewhere: "administrator role" is not "anything
  // containing role".
  return {
    $and: words.map((word) => ({
      $or: [
        { title: { $regex: word, $options: 'i' } },
        { module: { $regex: word, $options: 'i' } },
        { ticketId: { $regex: word, $options: 'i' } },
      ],
    })),
  };
}

export async function buildTicketFilter(actor, query = {}, permissionContext = null) {
  const filter = {};

  if (query.project) filter.project = query.project;
  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.category) filter.category = query.category;
  if (query.severity) filter.severity = query.severity;
  if (query.label) filter.labels = query.label;
  if (query.module) filter.module = query.module;
  if (query.assignedTo) filter.assignedTo = query.assignedTo;
  if (query.team) filter.team = query.team;
  if (query.blocked === 'true' || query.blocked === true) filter.blocked = true;
  if (query.reopened === 'true' || query.reopened === true) filter.reopenCount = { $gt: 0 };
  if (query.overdue === 'true' || query.overdue === true) {
    filter.estimatedResolutionAt = { $lt: new Date() };
    // Match frontend isOverdue(): closed and live tickets never count as overdue.
    if (!filter.status) filter.status = { $nin: ['closed', 'live'] };
  }

  // Scope resolves against req.user, never against an id in the query string.
  const scope = scopeFilter(query.scope, actor._id);
  if (scope) Object.assign(filter, scope);

  // $and, never $or: the search must narrow the filter above, not widen it,
  // and applyTicketVisibility wraps whatever we return in another $and.
  const search = ticketSearchClause(query.q);
  if (search) filter.$and = [...(filter.$and ?? []), search];

  return applyTicketVisibility(filter, actor, permissionContext);
}

const TICKET_OBJECT_ID_FIELDS = new Set([
  '_id', 'project', 'team', 'assignedTo', 'testedBy', 'createdBy', 'blockedBy', 'watchers',
]);

function castObjectIdLike(value) {
  if (value == null) return value;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === 'string' && mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return value;
}

function castObjectIdOperands(value) {
  return Array.isArray(value) ? value.map(castObjectIdLike) : castObjectIdLike(value);
}

/** countDocuments casts string refs; aggregate $match does not — align semantics. */
function normalizeFilterForAggregate(filter) {
  if (filter == null || typeof filter !== 'object') return filter;
  if (Array.isArray(filter)) return filter.map((entry) => normalizeFilterForAggregate(entry));

  const normalized = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key.startsWith('$')) {
      if (key === '$and' || key === '$or' || key === '$nor') {
        normalized[key] = value.map((entry) => normalizeFilterForAggregate(entry));
      } else {
        normalized[key] = normalizeFilterForAggregate(value);
      }
      continue;
    }

    if (TICKET_OBJECT_ID_FIELDS.has(key)) {
      if (
        value != null
        && typeof value === 'object'
        && !Array.isArray(value)
        && !(value instanceof Date)
        && !(value instanceof mongoose.Types.ObjectId)
      ) {
        const operand = {};
        for (const [op, opValue] of Object.entries(value)) {
          operand[op] = (op === '$in' || op === '$nin' || op === '$eq' || op === '$ne')
            ? castObjectIdOperands(opValue)
            : normalizeFilterForAggregate(opValue);
        }
        normalized[key] = operand;
      } else {
        normalized[key] = castObjectIdLike(value);
      }
    } else {
      normalized[key] = normalizeFilterForAggregate(value);
    }
  }
  return normalized;
}

function aggregateSortStages(sortBy) {
  const direction = sortBy.endsWith(':asc') ? 1 : -1;
  if (sortBy.startsWith('ticketId:')) {
    return [
      {
        $addFields: {
          ticketSeq: {
            $convert: {
              input: { $arrayElemAt: [{ $split: ['$ticketId', '-'] }, -1] },
              to: 'int',
              onError: 0,
            },
          },
        },
      },
      { $sort: { ticketSeq: direction, createdAt: -1 } },
    ];
  }
  if (sortBy.startsWith('assignedTo:')) {
    return [
      {
        $lookup: {
          from: 'users',
          localField: 'assignedTo',
          foreignField: '_id',
          as: '_ownerDoc',
        },
      },
      {
        $addFields: {
          _ownerName: { $ifNull: [{ $arrayElemAt: ['$_ownerDoc.name', 0] }, ''] },
        },
      },
      { $sort: { _ownerName: direction, createdAt: -1 } },
    ];
  }
  if (sortBy.startsWith('currentStageEnteredAt:')) {
    return [
      {
        $addFields: {
          effectiveStageEnteredAt: {
            $ifNull: ['$currentStageEnteredAt', '$updatedAt'],
          },
        },
      },
      { $sort: { effectiveStageEnteredAt: direction, createdAt: -1 } },
    ];
  }
  return null;
}

async function paginateTickets(model, filter, options = {}) {
  const sortBy = options.sortBy;
  const sortStages = sortBy ? aggregateSortStages(sortBy) : null;
  if (!sortStages) {
    return paginate(model, filter, options);
  }

  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
  const skip = (page - 1) * limit;
  const matchFilter = normalizeFilterForAggregate(filter);

  const [totalResults, idRows] = await Promise.all([
    model.countDocuments(filter).exec(),
    model.aggregate([
      { $match: matchFilter },
      ...sortStages,
      { $skip: skip },
      { $limit: limit },
      { $project: { _id: 1 } },
    ]),
  ]);

  const ids = idRows.map((row) => row._id);
  if (ids.length === 0) {
    return {
      results: [],
      page,
      limit,
      totalPages: Math.ceil(totalResults / limit) || 1,
      totalResults,
    };
  }

  let query = model.find({ _id: { $in: ids } });
  if (options.select) query = query.select(options.select);
  for (const path of options.populate || []) query = query.populate(path);
  const fetched = await query.exec();
  const order = new Map(ids.map((id, index) => [String(id), index]));
  fetched.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));

  return {
    results: fetched,
    page,
    limit,
    totalPages: Math.ceil(totalResults / limit) || 1,
    totalResults,
  };
}

export async function listTickets(actor, query = {}, permissionContext = null) {
  const ctx = await resolvePermissionContext(actor, permissionContext);
  await assertHasTicketPermission(actor, 'tickets.view', ctx);
  const page = await paginateTickets(Ticket, await buildTicketFilter(actor, query, ctx), {
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy || 'createdAt:desc',
    populate: LIST_POPULATE,
    // The list never needs the embedded arrays; excluding them keeps a 50-row
    // page from carrying every comment on every ticket.
    select: '-comments -activityLog -stageHistory',
  });

  return {
    ...page,
    results: page.results.map((t) => {
      const json = t.toJSON();
      return isPureExternalActor(actor) ? sanitizeExternalTicket(json, { viewerId: actor._id }) : json;
    }),
  };
}

const EDITABLE_FIELDS = [
  'title', 'description', 'stepsToReproduce', 'module', 'page', 'environment',
  'category', 'labels', 'severity', 'priority', 'testedBy',
  'estimatedResolutionAt', 'expectedReleaseDate',
];

const sameId = (a, b) => !!a && !!b && String(a._id ?? a) === String(b._id ?? b);

/**
 * Layer 2, document-dependent half. Runs AFTER the load, in the service — it
 * cannot be middleware, because the document does not exist at that point,
 * which is exactly how an ownership check ends up not checking ownership.
 * Identity comes from req.user; nothing here reads the request body.
 */
async function isActorOnTicketTeam(actorId, ticket) {
  let teamId = ticket.team?._id ?? ticket.team;

  // No team of its own — fall back to the project's team, matching listTickets.
  if (!teamId) {
    const projectId = ticket.project?._id ?? ticket.project;
    if (!projectId) return false;
    const project = ticket.project?.team !== undefined
      ? ticket.project
      : await Project.findById(projectId).select('team').lean();
    teamId = project?.team?._id ?? project?.team;
    if (!teamId) return false;
  }

  const team = ticket.team?.members
    ? ticket.team
    : await Team.findById(teamId).select('members lead').lean();
  if (!team) return false;

  return sameId(team.lead, actorId)
    || (team.members || []).some((member) => sameId(member, actorId));
}

async function assertTicketInActorScope(actor, ticket, permission, permissionContext = null) {
  if (isPureExternalActor(actor)) {
    if (!(await canExternalViewTicket(actor, ticket))) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this ticket');
    }
    return;
  }

  const ctx = await resolvePermissionContext(actor, permissionContext);
  const scope = ticketScopeTarget(ticket);
  if (hasActiveScopedConstraints(ctx.scopedAssignments)) {
    if (!canInScope(actor, permission, scope, ctx)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this ticket');
    }
    return;
  }

  if (hasGlobalTicketView(actor, ctx)) return;

  if (sameId(ticket.createdBy, actor._id) || sameId(ticket.assignedTo, actor._id)) return;

  if (sameId(ticket.testedBy, actor._id)) return;

  if ((ticket.watchers || []).some((watcher) => sameId(watcher, actor._id))) return;

  if (await isActorOnTicketTeam(actor._id, ticket)) return;

  throw new ApiError(
    403, 'FORBIDDEN',
    'Only the reporter, assignee, tester, watcher, team member, project admin or admin may access this ticket',
  );
}

export async function assertCanViewTicket(actor, ticket, permissionContext = null) {
  await assertHasTicketPermission(actor, 'tickets.view', permissionContext);
  await assertTicketInActorScope(actor, ticket, 'tickets.view', permissionContext);
}

export async function assertCanEditTicket(actor, ticket, permissionContext = null) {
  await assertHasTicketPermission(actor, 'tickets.edit', permissionContext);

  if (isPureExternalActor(actor)) {
    await assertTicketInActorScope(actor, ticket, 'tickets.edit', permissionContext);
    return;
  }

  const ctx = await resolvePermissionContext(actor, permissionContext);
  const scope = ticketScopeTarget(ticket);
  if (hasActiveScopedConstraints(ctx.scopedAssignments)) {
    if (!canInScope(actor, 'tickets.edit', scope, ctx)) {
      throw new ApiError(
        403, 'FORBIDDEN',
        'You do not have permission to edit this ticket in this scope',
      );
    }
    return;
  }

  const privileged = hasAnyRole(actor, ...ADMIN_ROLES, ROLE_IDS.PROJECT_ADMIN);
  const related = sameId(ticket.createdBy, actor._id) || sameId(ticket.assignedTo, actor._id);

  if (!privileged && !related) {
    throw new ApiError(
      403, 'FORBIDDEN',
      'Only the reporter, the assignee, a project admin or an admin may edit this ticket',
    );
  }
}

function assertCanEditEstimateDates(actor, patch) {
  const changing = 'estimatedResolutionAt' in patch || 'expectedReleaseDate' in patch;
  if (!changing) return;
  if (!hasAnyRole(actor, ...ESTIMATE_DATE_EDITOR_ROLES)) {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Only admin, developer, or project admin may change estimate dates',
    );
  }
}

function staleRevision(current) {
  return new ApiError(
    409, 'STALE_REVISION',
    'This ticket changed since you loaded it. Reload and reapply your edit.',
    { currentRevision: current.revision, currentStatus: current.status },
  );
}

/**
 * Compare-and-set on `revision`. The read that produced `revision` and this
 * write are not the same operation, which is exactly why the write is
 * conditional: a losing writer modifies nothing and is told so.
 */
async function applyConditionalUpdate(ticket, revision, update) {
  const written = await Ticket.findOneAndUpdate(
    { _id: ticket._id, revision },
    update,
    { new: true, runValidators: true },
  );

  if (!written) {
    const current = await Ticket.findById(ticket._id).select('revision status');
    throw staleRevision(current ?? { revision, status: ticket.status });
  }
  return written;
}

export async function patchTicket(actor, idOrKey, body, permissionContext = null) {
  const { revision, ...rest } = body;
  const ticket = await resolveTicketDoc(idOrKey);
  await assertCanEditTicket(actor, ticket, permissionContext);

  const patch = {};
  const changes = [];
  for (const field of EDITABLE_FIELDS) {
    if (!(field in rest)) continue;
    patch[field] = rest[field];
    changes.push({ field, from: ticket[field], to: rest[field] });
  }

  if (changes.length === 0) {
    throw new ApiError(400, 'NOTHING_TO_UPDATE', 'No editable fields were supplied');
  }

  if ('module' in patch || 'page' in patch) {
    const project = await Project.findById(ticket.project);
    assertModuleAndPage(project, patch.module ?? ticket.module, patch.page ?? ticket.page);
  }
  if ('testedBy' in patch) await assertActiveUsers([patch.testedBy]);

  assertCanEditEstimateDates(actor, patch);

  const estimateChangedFields = [];
  if ('estimatedResolutionAt' in patch
    && ticketDateKey(patch.estimatedResolutionAt) !== ticketDateKey(ticket.estimatedResolutionAt)) {
    estimateChangedFields.push('estimatedResolutionAt');
  }
  if ('expectedReleaseDate' in patch
    && ticketDateKey(patch.expectedReleaseDate) !== ticketDateKey(ticket.expectedReleaseDate)) {
    estimateChangedFields.push('expectedReleaseDate');
  }

  const dateFields = validateTicketEstimateDates(
    ...Object.values(resolveTicketEstimateDates(ticket, patch)),
    { changedFields: estimateChangedFields },
  );
  if (dateFields) {
    const firstMessage = Object.values(dateFields)[0];
    throw new ApiError(
      400,
      'INVALID_ESTIMATE_DATES',
      firstMessage || 'Invalid estimate dates',
      dateFields,
    );
  }

  const written = await applyConditionalUpdate(ticket, revision, {
    $set: { ...patch, revision: revision + 1 },
    $push: { activityLog: { action: 'updated', performedBy: actor._id, at: new Date(), changes } },
  });

  return written.toJSON();
}

export async function assignTicket(actor, idOrKey, { assignedTo, team, revision }, permissionContext = null) {
  const ticket = await resolveTicketDoc(idOrKey);

  const ctx = await resolvePermissionContext(actor, permissionContext);
  const scope = ticketScopeTarget(ticket);
  if (hasActiveScopedConstraints(ctx.scopedAssignments)) {
    if (!canInScope(actor, 'tickets.edit', scope, ctx)) {
      throw new ApiError(403, 'FORBIDDEN', 'Requires permission: tickets.edit in scope');
    }
  } else if (!hasAnyRole(actor, ...ADMIN_ROLES, ROLE_IDS.PROJECT_ADMIN)) {
    throw new ApiError(403, 'FORBIDDEN', 'Only a project admin or an admin may assign tickets');
  }

  const patch = {};
  const changes = [];
  const projectId = ticket.project?._id ?? ticket.project;
  await ensureProjectMigrated(projectId);

  if (team !== undefined) {
    if (team) await assertTeamUsable(team, ticket.project);
    patch.team = team;
    changes.push({ field: 'team', from: ticket.team, to: team });
  }

  if (assignedTo !== undefined) {
    await assertActiveUsers([assignedTo]);
    const teamId = patch.team ?? ticket.team?._id ?? ticket.team ?? undefined;
    if (assignedTo) await assertAssigneeOnProjectTeam(projectId, teamId, assignedTo);
    patch.assignedTo = assignedTo;
    changes.push({ field: 'assignedTo', from: ticket.assignedTo, to: assignedTo });
  }
  if (changes.length === 0) {
    throw new ApiError(400, 'NOTHING_TO_UPDATE', 'Supply assignedTo or team');
  }

  const written = await applyConditionalUpdate(ticket, revision, {
    $set: { ...patch, revision: revision + 1 },
    $push: { activityLog: { action: 'assigned', performedBy: actor._id, at: new Date(), changes } },
  });

  return written.toJSON();
}

/** Watch/unwatch carry no revision: $addToSet and $pull are already idempotent. */
export async function watchTicket(actor, idOrKey) {
  const ticket = await resolveTicketDoc(idOrKey);
  await assertCanViewTicket(actor, ticket);
  await Ticket.updateOne({ _id: ticket._id }, { $addToSet: { watchers: actor._id } });
  return getTicket(actor, String(ticket._id));
}

export async function unwatchTicket(actor, idOrKey) {
  const ticket = await resolveTicketDoc(idOrKey);
  await assertCanViewTicket(actor, ticket);
  await Ticket.updateOne({ _id: ticket._id }, { $pull: { watchers: actor._id } });
  return getTicket(actor, String(ticket._id));
}

/**
 * Blocked is orthogonal to stage. Set/clear are revisioned so two people
 * cannot silently overwrite each other's triage note.
 */
export async function setBlocked(actor, idOrKey, { revision, reason }, permissionContext = null) {
  const ticket = await resolveTicketDoc(idOrKey);
  await assertCanEditTicket(actor, ticket, permissionContext);

  const note = String(reason || '').trim();
  if (!note) {
    throw new ApiError(400, 'BLOCKER_REASON_REQUIRED', 'A blocker reason is required');
  }

  const now = new Date();
  const written = await applyConditionalUpdate(ticket, revision, {
    $set: {
      blocked: true,
      blockerReason: note,
      blockedAt: now,
      blockedBy: actor._id,
      revision: revision + 1,
    },
    $push: {
      activityLog: {
        action: 'blocked',
        performedBy: actor._id,
        at: now,
        changes: [
          { field: 'blocked', from: ticket.blocked, to: true },
          { field: 'blockerReason', from: ticket.blockerReason, to: note },
        ],
      },
    },
  });

  return written.toJSON();
}

export async function clearBlocked(actor, idOrKey, { revision }, permissionContext = null) {
  const ticket = await resolveTicketDoc(idOrKey);
  await assertCanEditTicket(actor, ticket, permissionContext);

  if (!ticket.blocked) {
    throw new ApiError(400, 'NOT_BLOCKED', 'This ticket is not blocked');
  }

  const now = new Date();
  const written = await applyConditionalUpdate(ticket, revision, {
    $set: {
      blocked: false,
      revision: revision + 1,
    },
    $unset: { blockerReason: 1, blockedAt: 1, blockedBy: 1 },
    $push: {
      activityLog: {
        action: 'unblocked',
        performedBy: actor._id,
        at: now,
        changes: [{ field: 'blocked', from: true, to: false }],
      },
    },
  });

  return written.toJSON();
}

export async function assertCanDeleteTicket(actor, ticket, permissionContext = null) {
  await assertHasTicketPermission(actor, 'tickets.delete', permissionContext);
  await assertTicketInActorScope(actor, ticket, 'tickets.delete', permissionContext);
  if (!isPureExternalActor(actor)) {
    await assertScopedPermissionWhenConstrained(
      actor,
      'tickets.delete',
      ticketScopeTarget(ticket),
      permissionContext,
    );
  }
}

export async function deleteTicket(idOrKey, actor = null, permissionContext = null) {
  if (!actor) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  }
  const ticket = await resolveTicketDoc(idOrKey);
  await assertHasTicketPermission(actor, 'tickets.delete', permissionContext);
  await assertTicketInActorScope(actor, ticket, 'tickets.delete', permissionContext);
  if (!isPureExternalActor(actor)) {
    await assertScopedPermissionWhenConstrained(
      actor,
      'tickets.delete',
      ticketScopeTarget(ticket),
      permissionContext,
    );
  }
  await Ticket.deleteOne({ _id: ticket._id });
  return { id: String(ticket._id), ticketId: ticket.ticketId };
}

/**
 * Every item is loaded and authorized on its own. Returning 200 with per-item
 * results — rather than failing the batch — is what makes a mixed-permission
 * selection legible instead of mysterious.
 */
export async function bulkTickets(actor, { action, ids, assignedTo, team }, permissionContext = null) {
  const results = [];

  for (const id of ids) {
    try {
      if (action === 'delete') {
        if (!hasAnyRole(actor, ...ADMIN_ROLES)) {
          throw new ApiError(403, 'FORBIDDEN', 'Only an admin may delete tickets');
        }
        const removed = await deleteTicket(id, actor, permissionContext);
        results.push({ id, ok: true, ticketId: removed.ticketId });
      } else {
        const current = await resolveTicketDoc(id);
        const updated = await assignTicket(actor, id, {
          assignedTo, team, revision: current.revision,
        }, permissionContext);
        results.push({ id, ok: true, ticketId: updated.ticketId });
      }
    } catch (err) {
      results.push({
        id,
        ok: false,
        error: { code: err.code || 'INTERNAL_ERROR', message: err.message },
      });
    }
  }

  return {
    results,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
}