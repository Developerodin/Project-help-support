import { randomUUID } from 'node:crypto';
import {
  CATEGORIES, PRIORITIES, SEVERITIES, STAGE_KEYS,
  can, isExternalUser, isTicketOverdue, resolveProjectModules, stageLabel,
} from '@pms/shared';
import { getTicket, listTickets } from '../tickets/ticket.service.js';
import { assertModuleAndPage, listProjects } from '../projects/project.service.js';

/*
 * Every read runs through the same service call the REST API uses, with the
 * signed-in user's permission context, so the assistant can never see more
 * than that user could in the app. Writes are never executed here: a
 * propose_* tool only records an action that the UI shows as a confirmation
 * card, and confirming it calls the normal REST endpoint.
 */

const SEARCH_LIMIT = 20;
const nullable = (schema) => ({ ...schema, type: [schema.type, 'null'] });
const nullableEnum = (values) => ({ type: ['string', 'null'], enum: [...values, null] });
const clip = (text, max) => {
  const value = String(text ?? '').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
};
const day = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

function fn(name, description, properties) {
  return {
    type: 'function',
    name,
    description,
    strict: true,
    parameters: {
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    },
  };
}

const TICKET_ID = { type: 'string', description: 'Human ticket id such as WEB-55.' };

const SEARCH_TICKETS = fn(
  'search_tickets',
  `Find tickets the user can see. Returns up to ${SEARCH_LIMIT}, newest first. Use null for any filter you don't need.`,
  {
    query: nullable({ type: 'string', description: 'Words from the title/module, or a ticket id.' }),
    project_key: nullable({ type: 'string', description: 'Project key such as WEB.' }),
    stage: nullableEnum(STAGE_KEYS),
    priority: nullableEnum(PRIORITIES),
    module: nullable({ type: 'string', description: 'Exact module label.' }),
    overdue: nullable({ type: 'boolean' }),
    blocked: nullable({ type: 'boolean' }),
    scope: nullableEnum(['assigned', 'reported', 'unassigned']),
  },
);

const GET_TICKET = fn('get_ticket', 'Full details and recent discussion for one ticket.', { ticket_id: TICKET_ID });

const LIST_PROJECTS = fn(
  'list_projects',
  'Projects the user can access, with their modules and pages. Call before proposing a new ticket.',
  {},
);

const PROPOSE_CREATE = fn(
  'propose_create_ticket',
  'Draft a new ticket. The user sees it as a card and must confirm; nothing is created until they do.',
  {
    project_key: { type: 'string' },
    title: { type: 'string', description: '5 to 200 characters.' },
    description: { type: 'string', description: '10 to 5000 characters.' },
    steps_to_reproduce: nullable({ type: 'string' }),
    module: nullable({ type: 'string', description: 'Exact module label from list_projects.' }),
    page: nullable({ type: 'string', description: 'Exact page label within that module.' }),
    category: nullableEnum(CATEGORIES),
    priority: nullableEnum(PRIORITIES),
    severity: nullableEnum(SEVERITIES),
  },
);

const PROPOSE_UPDATE = fn(
  'propose_update_ticket',
  'Draft changes to a ticket\'s fields. The user must confirm. Use null for fields that stay the same.',
  {
    ticket_id: TICKET_ID,
    title: nullable({ type: 'string' }),
    priority: nullableEnum(PRIORITIES),
    severity: nullableEnum(SEVERITIES),
    category: nullableEnum(CATEGORIES),
    module: nullable({ type: 'string' }),
    page: nullable({ type: 'string' }),
  },
);

const PROPOSE_STAGE = fn(
  'propose_stage_change',
  'Draft moving a ticket to another stage. The user must confirm.',
  {
    ticket_id: TICKET_ID,
    to_stage: { type: 'string', enum: [...STAGE_KEYS] },
    note: nullable({ type: 'string', description: 'Optional note for the stage history.' }),
  },
);

/**
 * Pages the assistant may open. Hrefs are built here from fixed values, so the
 * model can never send the browser to an arbitrary URL. Pages the user lacks
 * access to are still stopped by the app's route guard.
 */
const DESTINATIONS = Object.freeze({
  tickets: { path: '/tickets', label: 'Tickets' },
  board: { path: '/tickets/board', label: 'Board' },
  analytics: { path: '/tickets/analytics', label: 'Analytics' },
  new_ticket: { path: '/tickets/new', label: 'New ticket' },
  ticket: { path: '/tickets', label: 'Ticket' },
  notifications: { path: '/notifications', label: 'Notifications' },
  notification_settings: { path: '/settings/notifications', label: 'Notification settings' },
  projects: { path: '/projects', label: 'Projects' },
  teams: { path: '/teams', label: 'Teams' },
  users: { path: '/users', label: 'Users' },
  profile: { path: '/profile', label: 'Profile' },
});

const NAVIGATE = fn(
  'navigate',
  'Open a page for the user right away: go to a page, open a ticket, or show a filtered ticket list. '
    + 'Filters and view apply only to destination "tickets"; ticket_id only to "ticket". Use null for the rest.',
  {
    destination: { type: 'string', enum: Object.keys(DESTINATIONS) },
    ticket_id: nullable(TICKET_ID),
    view: nullableEnum(['table', 'modules']),
    query: nullable({ type: 'string' }),
    stage: nullableEnum(STAGE_KEYS),
    priority: nullableEnum(PRIORITIES),
    module: nullable({ type: 'string', description: 'Exact module label.' }),
    scope: nullableEnum(['assigned', 'reported', 'unassigned']),
    overdue: nullable({ type: 'boolean' }),
    blocked: nullable({ type: 'boolean' }),
  },
);

/** Tools offered to this user. Proposals they could never confirm aren't offered. */
export function toolsFor(user, permissionContext) {
  const external = isExternalUser(user);
  const tools = [SEARCH_TICKETS, GET_TICKET, LIST_PROJECTS, NAVIGATE];
  if (external || can(user, 'tickets.create', permissionContext)) tools.push(PROPOSE_CREATE);
  if (!external && can(user, 'tickets.edit', permissionContext)) tools.push(PROPOSE_UPDATE);
  tools.push(PROPOSE_STAGE);
  return tools;
}

function summarize(ticket) {
  return {
    id: ticket.ticketId,
    title: ticket.title,
    stage: stageLabel(ticket.status),
    priority: ticket.priority ?? null,
    category: ticket.category ?? null,
    project: ticket.project?.key ?? null,
    module: ticket.module || null,
    page: ticket.page || null,
    owner: ticket.assignedTo?.name ?? null,
    due: day(ticket.estimatedResolutionAt),
    overdue: isTicketOverdue(ticket),
    blocked: Boolean(ticket.blocked),
  };
}

async function projectsFor(ctx) {
  ctx.projects ??= (await listProjects({ limit: 100 }, ctx.user, ctx.permissionContext)).results;
  return ctx.projects;
}

async function projectByKey(ctx, key) {
  const wanted = String(key || '').trim().toUpperCase();
  const project = (await projectsFor(ctx)).find((p) => String(p.key).toUpperCase() === wanted);
  if (!project) throw new ToolError(`No accessible project with key "${key}". Call list_projects.`);
  return project;
}

class ToolError extends Error {}

function proposal(ctx, action) {
  ctx.actions.push({ id: randomUUID(), ...action });
  return { status: 'proposed', note: 'Shown to the user as a confirmation card. Nothing changes until they confirm.' };
}

const HANDLERS = {
  async search_tickets(args, ctx) {
    const query = { page: 1, limit: SEARCH_LIMIT };
    if (args.query) query.q = args.query;
    if (args.project_key) query.project = String((await projectByKey(ctx, args.project_key)).id);
    if (args.stage) query.status = args.stage;
    if (args.priority) query.priority = args.priority;
    if (args.module) query.module = args.module;
    if (args.overdue) query.overdue = true;
    if (args.blocked) query.blocked = true;
    if (args.scope) query.scope = args.scope;
    const page = await listTickets(ctx.user, query, ctx.permissionContext);
    return { total: page.totalResults, shown: page.results.length, tickets: page.results.map(summarize) };
  },

  async get_ticket(args, ctx) {
    const ticket = await getTicket(ctx.user, args.ticket_id, ctx.permissionContext);
    return {
      ...summarize(ticket),
      severity: ticket.severity ?? null,
      reporter: ticket.createdBy?.name ?? null,
      blocker_reason: ticket.blocked ? (ticket.blockerReason || null) : null,
      description: clip(ticket.description, 1500),
      steps_to_reproduce: clip(ticket.stepsToReproduce, 800) || null,
      recent_comments: (ticket.comments || []).slice(-5).map((comment) => ({
        by: comment.commentedBy?.name ?? null,
        at: day(comment.createdAt),
        internal: Boolean(comment.internal),
        text: clip(comment.content, 400),
      })),
    };
  },

  async list_projects(_args, ctx) {
    return (await projectsFor(ctx)).map((project) => ({
      key: project.key,
      name: project.name,
      modules: resolveProjectModules(project).map((module) => ({
        label: module.label,
        pages: (module.pages || []).map((page) => page.label),
      })),
    }));
  },

  async navigate(args, ctx) {
    const destination = DESTINATIONS[args.destination];
    if (!destination) throw new ToolError(`Unknown destination ${args.destination}.`);
    let href = destination.path;
    let { label } = destination;
    if (args.destination === 'ticket') {
      if (!args.ticket_id) throw new ToolError('Say which ticket to open.');
      const ticket = await getTicket(ctx.user, args.ticket_id, ctx.permissionContext);
      href = `/tickets?ticket=${encodeURIComponent(ticket.ticketId)}`;
      label = ticket.ticketId;
    } else if (args.destination === 'tickets') {
      // Same param names the ticket list reads from its URL (ticket-list-query.js).
      const params = new URLSearchParams();
      if (args.view === 'modules') params.set('view', 'modules');
      if (args.query) params.set('q', args.query);
      if (args.stage) params.set('status', args.stage);
      if (args.priority) params.set('priority', args.priority);
      if (args.module) params.set('module', args.module);
      if (args.scope) params.set('scope', args.scope);
      if (args.overdue) params.set('overdue', '1');
      if (args.blocked) params.set('blocked', '1');
      const search = params.toString();
      if (search) href = `${href}?${search}`;
    }
    ctx.actions.push({ id: randomUUID(), type: 'navigate', href, label });
    return { status: 'opened', page: label };
  },

  async propose_create_ticket(args, ctx) {
    const project = await projectByKey(ctx, args.project_key);
    const title = String(args.title || '').trim();
    const description = String(args.description || '').trim();
    if (title.length < 5 || title.length > 200) throw new ToolError('Title must be 5 to 200 characters.');
    if (description.length < 10) throw new ToolError('Description must be at least 10 characters. Ask the user for more detail.');
    try {
      assertModuleAndPage(project, args.module || undefined, args.page || undefined);
    } catch (err) {
      throw new ToolError(`${err.message}. Use exact labels from list_projects.`);
    }
    return proposal(ctx, {
      type: 'create_ticket',
      projectKey: project.key,
      body: {
        project: String(project.id),
        title,
        description: clip(description, 5000),
        ...(args.steps_to_reproduce ? { stepsToReproduce: args.steps_to_reproduce } : {}),
        ...(args.module ? { module: args.module } : {}),
        ...(args.page ? { page: args.page } : {}),
        ...(args.category ? { category: args.category } : {}),
        ...(args.priority ? { priority: args.priority } : {}),
        ...(args.severity ? { severity: args.severity } : {}),
      },
    });
  },

  async propose_update_ticket(args, ctx) {
    const ticket = await getTicket(ctx.user, args.ticket_id, ctx.permissionContext);
    const changes = {};
    for (const field of ['title', 'priority', 'severity', 'category', 'module', 'page']) {
      if (args[field] != null && args[field] !== ticket[field]) changes[field] = args[field];
    }
    if (!Object.keys(changes).length) throw new ToolError('Nothing would change. Ask what should be different.');
    return proposal(ctx, {
      type: 'update_ticket',
      ticketId: ticket.ticketId,
      title: ticket.title,
      from: Object.fromEntries(Object.keys(changes).map((field) => [field, ticket[field] ?? null])),
      changes,
    });
  },

  async propose_stage_change(args, ctx) {
    const ticket = await getTicket(ctx.user, args.ticket_id, ctx.permissionContext);
    if (ticket.status === args.to_stage) throw new ToolError(`${ticket.ticketId} is already in ${stageLabel(args.to_stage)}.`);
    return proposal(ctx, {
      type: 'stage_change',
      ticketId: ticket.ticketId,
      title: ticket.title,
      from: ticket.status,
      to: args.to_stage,
      ...(args.note ? { note: args.note } : {}),
    });
  },
};

/**
 * Runs one tool call. Failures become a message the model can act on (a 403 or
 * 404 reads as "not found or not allowed"), never an exception that ends the chat.
 */
export async function runTool(name, rawArgs, ctx) {
  const handler = HANDLERS[name];
  if (!handler) return { error: `Unknown tool ${name}.` };
  let args;
  try {
    args = JSON.parse(rawArgs || '{}');
  } catch {
    return { error: 'Arguments were not valid JSON.' };
  }
  try {
    return await handler(args, ctx);
  } catch (err) {
    if (err instanceof ToolError) return { error: err.message };
    if (err?.statusCode === 403 || err?.statusCode === 404) {
      return { error: 'Not found, or the user does not have access to it.' };
    }
    if (err?.statusCode === 400) return { error: err.message };
    throw err;
  }
}
