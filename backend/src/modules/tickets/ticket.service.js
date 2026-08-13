import mongoose from 'mongoose';
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import Project from '../projects/project.model.js';
import { assertModuleAndPage } from '../projects/project.service.js';
import { assertTeamUsable, assertActiveUsers } from '../teams/team.service.js';
import Ticket from './ticket.model.js';

export async function createTicket(actor, body) {
  const project = await Project.findById(body.project);
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  if (project.status !== 'active') {
    throw new ApiError(400, 'PROJECT_ARCHIVED', 'That project is archived');
  }

  assertModuleAndPage(project, body.module, body.page);

  const assignedTo = body.assignedTo ?? project.defaultAssignee ?? undefined;
  const testedBy = body.testedBy ?? project.defaultTester ?? undefined;
  const team = body.team ?? project.defaultTeam ?? undefined;

  await assertActiveUsers([assignedTo, testedBy]);
  if (team) await assertTeamUsable(team, project._id);

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
    module: body.module,
    page: body.page,
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
    estimatedResolutionAt: body.estimatedResolutionAt,
    expectedReleaseDate: body.expectedReleaseDate,
    // The landing entry, so time-in-stage has a start for `pending` without
    // special-casing "the first stage has no history row".
    stageHistory: [{ to: 'pending', by: actor._id, at: now }],
    activityLog: [{ action: 'created', performedBy: actor._id, at: now, changes: [] }],
  });

  return ticket.toJSON();
}

const DETAIL_POPULATE = [
  'project', 'assignedTo', 'testedBy', 'team', 'watchers', 'createdBy',
  'comments.commentedBy', 'comments.mentions', 'stageHistory.by', 'activityLog.performedBy',
];

const LIST_POPULATE = ['project', 'assignedTo', 'team', 'createdBy'];

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

export async function getTicket(idOrKey) {
  const ticket = await resolveTicketDoc(idOrKey, { populate: DETAIL_POPULATE });
  return ticket.toJSON();
}

function scopeFilter(scope, actorId) {
  switch (scope) {
    case 'assigned': return { assignedTo: actorId };
    case 'reported': return { createdBy: actorId };
    case 'unassigned': return { assignedTo: null, team: null };
    default: return null;
  }
}

export function buildTicketFilter(actor, query = {}) {
  const filter = {};

  if (query.project) filter.project = query.project;
  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.severity) filter.severity = query.severity;
  if (query.label) filter.labels = query.label;
  if (query.module) filter.module = query.module;
  if (query.assignedTo) filter.assignedTo = query.assignedTo;
  if (query.team) filter.team = query.team;

  // Scope resolves against req.user, never against an id in the query string.
  const scope = scopeFilter(query.scope, actor._id);
  if (scope) Object.assign(filter, scope);

  if (query.q) {
    const term = String(query.q).trim();
    // A text index will never match "WEB-101" — the tokenizer splits it and the
    // hyphenated form is not a stored term. The exact-id clause is what makes
    // pasting a ticket number work. Both clauses are indexed, which is what
    // MongoDB requires of every branch of an $or that contains $text.
    filter.$or = [
      { $text: { $search: term } },
      { ticketId: term.toUpperCase() },
    ];
  }

  return filter;
}

export async function listTickets(actor, query = {}) {
  const page = await paginate(Ticket, buildTicketFilter(actor, query), {
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy || 'createdAt:desc',
    populate: LIST_POPULATE,
    // The list never needs the embedded arrays; excluding them keeps a 50-row
    // page from carrying every comment on every ticket.
    select: '-comments -activityLog -stageHistory',
  });

  return { ...page, results: page.results.map((t) => t.toJSON()) };
}

const EDITABLE_FIELDS = [
  'title', 'description', 'module', 'page', 'category', 'labels',
  'severity', 'priority', 'testedBy', 'estimatedResolutionAt', 'expectedReleaseDate',
];

const sameId = (a, b) => !!a && !!b && String(a._id ?? a) === String(b._id ?? b);

/**
 * Layer 2, document-dependent half. Runs AFTER the load, in the service — it
 * cannot be middleware, because the document does not exist at that point,
 * which is exactly how an ownership check ends up not checking ownership.
 * Identity comes from req.user; nothing here reads the request body.
 */
export function assertCanEditTicket(actor, ticket) {
  const privileged = actor.role === 'admin' || actor.role === 'lead';
  const related = sameId(ticket.createdBy, actor._id) || sameId(ticket.assignedTo, actor._id);

  if (!privileged && !related) {
    throw new ApiError(
      403, 'FORBIDDEN',
      'Only the reporter, the assignee, a lead or an admin may edit this ticket',
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

export async function patchTicket(actor, idOrKey, body) {
  const { revision, ...rest } = body;
  const ticket = await resolveTicketDoc(idOrKey);
  assertCanEditTicket(actor, ticket);

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

  const written = await applyConditionalUpdate(ticket, revision, {
    $set: { ...patch, revision: revision + 1 },
    $push: { activityLog: { action: 'updated', performedBy: actor._id, at: new Date(), changes } },
  });

  return written.toJSON();
}

export async function assignTicket(actor, idOrKey, { assignedTo, team, revision }) {
  const ticket = await resolveTicketDoc(idOrKey);

  if (actor.role !== 'admin' && actor.role !== 'lead') {
    throw new ApiError(403, 'FORBIDDEN', 'Only a lead or an admin may assign tickets');
  }

  const patch = {};
  const changes = [];
  if (assignedTo !== undefined) {
    await assertActiveUsers([assignedTo]);
    patch.assignedTo = assignedTo;
    changes.push({ field: 'assignedTo', from: ticket.assignedTo, to: assignedTo });
  }
  if (team !== undefined) {
    if (team) await assertTeamUsable(team, ticket.project);
    patch.team = team;
    changes.push({ field: 'team', from: ticket.team, to: team });
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
  await Ticket.updateOne({ _id: ticket._id }, { $addToSet: { watchers: actor._id } });
  return getTicket(String(ticket._id));
}

export async function unwatchTicket(actor, idOrKey) {
  const ticket = await resolveTicketDoc(idOrKey);
  await Ticket.updateOne({ _id: ticket._id }, { $pull: { watchers: actor._id } });
  return getTicket(String(ticket._id));
}

export async function deleteTicket(idOrKey) {
  const ticket = await resolveTicketDoc(idOrKey);
  await Ticket.deleteOne({ _id: ticket._id });
  return { id: String(ticket._id), ticketId: ticket.ticketId };
}

/**
 * Every item is loaded and authorized on its own. Returning 200 with per-item
 * results — rather than failing the batch — is what makes a mixed-permission
 * selection legible instead of mysterious.
 */
export async function bulkTickets(actor, { action, ids, assignedTo, team }) {
  const results = [];

  for (const id of ids) {
    try {
      if (action === 'delete') {
        if (actor.role !== 'admin') {
          throw new ApiError(403, 'FORBIDDEN', 'Only an admin may delete tickets');
        }
        const removed = await deleteTicket(id);
        results.push({ id, ok: true, ticketId: removed.ticketId });
      } else {
        const current = await resolveTicketDoc(id);
        const updated = await assignTicket(actor, id, {
          assignedTo, team, revision: current.revision,
        });
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