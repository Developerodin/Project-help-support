import { randomUUID } from 'node:crypto';
import {
  ADMIN_ROLES, CATEGORIES, ENVIRONMENTS, PRIORITIES, SEVERITIES, STAGES, STAGE_KEYS,
  can, hasAnyRole, isExternalUser, isTicketOverdue, resolveProjectModules, stageIndex, stageLabel,
} from '@pms/shared';
import { getTicket, listTickets } from '../tickets/ticket.service.js';
import { assertModuleAndPage, listProjects } from '../projects/project.service.js';
import { listClients } from '../clients/client.service.js';
import { listTeams } from '../teams/team.service.js';
import { listUsers } from '../users/user.service.js';

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
    new_reply: nullable({
      type: 'boolean',
      description: 'True for tickets with discussion replies this user has not read yet ("any new comments?").',
    }),
  },
);

const GET_TICKET = fn(
  'get_ticket',
  'Everything about one ticket: description, steps, where it is in the pipeline and how it got there, attachments, and the latest comments.',
  { ticket_id: TICKET_ID },
);

const GET_DISCUSSION = fn(
  'get_ticket_discussion',
  'The ticket\'s full discussion thread, oldest first (the latest 40 comments), with any files attached to comments.',
  { ticket_id: TICKET_ID },
);

const OPEN_ATTACHMENT = fn(
  'open_attachment',
  'Give the user a button to open one of a ticket\'s files (ids come from get_ticket or get_ticket_discussion). '
    + 'You cannot see inside files; describe them by name and type only.',
  { ticket_id: TICKET_ID, attachment_id: { type: 'string' } },
);

const SEARCH_USERS = fn(
  'search_users',
  'Look up people in the workspace by name or email: roles, status and last sign-in. Use it to find people for teams.',
  {
    query: nullable({ type: 'string' }),
    status: nullableEnum(['active', 'invited', 'inactive']),
  },
);

const LIST_TEAMS = fn('list_teams', 'Teams with their lead, members and project.', {
  project_key: nullable({ type: 'string' }),
});

const LIST_CLIENTS = fn(
  'list_clients',
  'Client companies. A client\'s brand is its name and logo, shown to that client\'s users.',
  {},
);

const MODULE_INPUT = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    pages: { type: 'array', items: { type: 'string' } },
  },
  required: ['label', 'pages'],
  additionalProperties: false,
};

const PROPOSE_CREATE_PROJECT = fn(
  'propose_create_project',
  'Draft a new project for a client, optionally with its modules and pages. The user must confirm.',
  {
    client_name: { type: 'string', description: 'Exact client name from list_clients.' },
    name: { type: 'string' },
    key: nullable({ type: 'string', description: '2-10 letters/digits starting with a letter, e.g. WEB. Null to derive from the name.' }),
    description: nullable({ type: 'string' }),
    modules: { type: ['array', 'null'], items: MODULE_INPUT },
  },
);

const PROPOSE_CREATE_TEAM = fn(
  'propose_create_team',
  'Draft a new team. People are given by email (find them with search_users). The user must confirm.',
  {
    name: { type: 'string' },
    project_key: nullable({ type: 'string', description: 'Null for a global team.' }),
    lead_email: nullable({ type: 'string' }),
    member_emails: { type: 'array', items: { type: 'string' } },
  },
);

const PROPOSE_CLIENT_BRAND = fn(
  'propose_client_brand',
  'Draft a client brand: create a new client company, or rename an existing one. '
    + 'The card lets the user attach a logo image before confirming.',
  {
    client_name: nullable({ type: 'string', description: 'Existing client to change; null to create a new client.' }),
    new_name: nullable({ type: 'string', description: 'Name to set; null keeps the current name.' }),
  },
);

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
    environment: nullableEnum(ENVIRONMENTS),
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
  const allowed = (permission) => !external && can(user, permission, permissionContext);
  const tools = [SEARCH_TICKETS, GET_TICKET, GET_DISCUSSION, OPEN_ATTACHMENT, LIST_PROJECTS, NAVIGATE];
  if (external || can(user, 'tickets.create', permissionContext)) tools.push(PROPOSE_CREATE);
  if (allowed('tickets.edit')) tools.push(PROPOSE_UPDATE);
  tools.push(PROPOSE_STAGE);
  // Same gates as the REST routes these mirror; the user directory is admin-only there too.
  const admin = !external && hasAnyRole(user, ...ADMIN_ROLES);
  if (admin) tools.push(SEARCH_USERS);
  if (allowed('teams.view')) tools.push(LIST_TEAMS);
  if (allowed('clients.view')) tools.push(LIST_CLIENTS);
  if (allowed('projects.manage') && allowed('clients.view')) tools.push(PROPOSE_CREATE_PROJECT);
  if (admin && allowed('teams.create')) tools.push(PROPOSE_CREATE_TEAM);
  if (allowed('clients.manage')) tools.push(PROPOSE_CLIENT_BRAND);
  return tools;
}

const idOf = (doc) => String(doc?.id ?? doc?._id ?? '');

/** Where a stage sits in the pipeline, for "how far along is it?" answers. */
function progress(status) {
  const index = stageIndex(status);
  return {
    stage_step: index >= 0 ? `${index + 1} of ${STAGES.length}` : null,
    next_stage: index >= 0 && index < STAGES.length - 1 ? STAGES[index + 1].label : null,
  };
}

const fileSummary = (file) => ({
  id: idOf(file),
  name: file.name,
  type: file.mimeType ?? null,
  size_kb: file.size ? Math.max(1, Math.round(file.size / 1024)) : null,
  uploaded: day(file.uploadedAt),
});

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
    unread_replies: Number(ticket.discussionUnreadCount) || 0,
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

async function clientsFor(ctx) {
  ctx.clients ??= (await listClients({ limit: 100 }, ctx.config, ctx.user, ctx.permissionContext)).results;
  return ctx.clients;
}

async function clientByName(ctx, name) {
  const wanted = String(name || '').trim().toLowerCase();
  const client = (await clientsFor(ctx)).find((entry) => entry.name.toLowerCase() === wanted);
  if (!client) throw new ToolError(`No client named "${name}". Call list_clients for exact names.`);
  return client;
}

async function userByEmail(ctx, email) {
  const wanted = String(email || '').trim().toLowerCase();
  const page = await listUsers(ctx.user, { q: wanted, limit: 5 });
  const person = page.results.find((entry) => entry.email?.toLowerCase() === wanted);
  if (!person) throw new ToolError(`No user with email ${email}. Use search_users to find the right address.`);
  if (person.status !== 'active') throw new ToolError(`${person.name} is ${person.status}; only active users can join a team.`);
  return person;
}

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
    if (args.new_reply) query.newReply = true;
    const page = await listTickets(ctx.user, query, ctx.permissionContext);
    return { total: page.totalResults, shown: page.results.length, tickets: page.results.map(summarize) };
  },

  async get_ticket(args, ctx) {
    const ticket = await getTicket(ctx.user, args.ticket_id, ctx.permissionContext);
    const comments = ticket.comments || [];
    return {
      ...summarize(ticket),
      ...progress(ticket.status),
      severity: ticket.severity ?? null,
      environment: ticket.environment ?? null,
      reporter: ticket.createdBy?.name ?? null,
      created: day(ticket.createdAt),
      reopened_times: ticket.reopenCount || 0,
      blocker_reason: ticket.blocked ? (ticket.blockerReason || null) : null,
      description: clip(ticket.description, 5000),
      steps_to_reproduce: clip(ticket.stepsToReproduce, 2000) || null,
      // Client users receive these already trimmed by the ticket service.
      stage_history: (ticket.stageHistory || []).slice(-12).map((entry) => ({
        from: entry.from ? stageLabel(entry.from) : null,
        to: stageLabel(entry.to),
        at: day(entry.at),
        by: entry.by?.name ?? null,
        ...(entry.decision ? { decision: entry.decision } : {}),
        ...(entry.note ? { note: clip(entry.note, 300) } : {}),
      })),
      attachments: (ticket.attachments || []).map(fileSummary),
      comment_count: comments.length,
      recent_comments: comments.slice(-5).map((comment) => ({
        by: comment.commentedBy?.name ?? null,
        at: day(comment.createdAt),
        internal: Boolean(comment.internal),
        text: clip(comment.content, 400),
      })),
    };
  },

  async get_ticket_discussion(args, ctx) {
    const ticket = await getTicket(ctx.user, args.ticket_id, ctx.permissionContext);
    const comments = ticket.comments || [];
    return {
      id: ticket.ticketId,
      total: comments.length,
      comments: comments.slice(-40).map((comment) => ({
        by: comment.commentedBy?.name ?? null,
        at: day(comment.createdAt),
        internal: Boolean(comment.internal),
        text: clip(comment.content, 2000),
        attachments: (comment.attachments || []).map(fileSummary),
      })),
    };
  },

  async open_attachment(args, ctx) {
    const ticket = await getTicket(ctx.user, args.ticket_id, ctx.permissionContext);
    // Only files the (possibly trimmed) ticket shows this user; the download
    // route re-checks access when the button is pressed.
    const files = [
      ...(ticket.attachments || []),
      ...(ticket.comments || []).flatMap((comment) => comment.attachments || []),
    ];
    const file = files.find((entry) => idOf(entry) === String(args.attachment_id));
    if (!file) throw new ToolError('No such file on that ticket. Use the ids from get_ticket.');
    ctx.actions.push({
      id: randomUUID(), type: 'attachment', ticketId: ticket.ticketId, attachmentId: idOf(file), name: file.name,
    });
    return { status: 'offered', note: 'A button to open the file is shown under your reply.' };
  },

  async search_users(args, ctx) {
    if (isExternalUser(ctx.user) || !hasAnyRole(ctx.user, ...ADMIN_ROLES)) throw new ToolError('Only admins can look up users.');
    const page = await listUsers(ctx.user, {
      limit: 20, ...(args.query ? { q: args.query } : {}), ...(args.status ? { status: args.status } : {}),
    });
    return {
      total: page.totalResults,
      users: page.results.map((person) => ({
        name: person.name,
        email: person.email,
        roles: person.roles?.length ? person.roles : [person.role].filter(Boolean),
        status: person.status,
        last_sign_in: day(person.lastLoginAt),
      })),
    };
  },

  async list_teams(args, ctx) {
    const query = { limit: 100 };
    if (args.project_key) query.project = idOf(await projectByKey(ctx, args.project_key));
    const page = await listTeams(query, ctx.user, ctx.permissionContext);
    return page.results.map((team) => ({
      name: team.name,
      project: team.project?.key ?? null,
      lead: team.lead?.name ?? null,
      members: (team.members || []).map((member) => member?.name).filter(Boolean),
      status: team.status,
    }));
  },

  async list_clients(_args, ctx) {
    return (await clientsFor(ctx)).map((client) => ({
      name: client.name, status: client.status, has_logo: Boolean(client.logoUrl),
    }));
  },

  async propose_create_project(args, ctx) {
    const client = await clientByName(ctx, args.client_name);
    const name = String(args.name || '').trim();
    if (!name || name.length > 120) throw new ToolError('Project name must be 1 to 120 characters.');
    const key = args.key ? String(args.key).trim().toUpperCase() : null;
    if (key && !/^[A-Z][A-Z0-9]{1,9}$/.test(key)) {
      throw new ToolError('Key must be 2-10 letters or digits and start with a letter, e.g. WEB.');
    }
    const modules = (args.modules || [])
      .map((module) => ({
        label: String(module.label || '').trim().slice(0, 80),
        pages: [...new Set((module.pages || []).map((page) => String(page).trim().slice(0, 80)).filter(Boolean))]
          .map((label) => ({ label })),
      }))
      .filter((module) => module.label);
    return proposal(ctx, {
      type: 'create_project',
      clientName: client.name,
      body: {
        clientId: idOf(client),
        name,
        ...(key ? { key } : {}),
        ...(args.description ? { description: clip(args.description, 1000) } : {}),
        modules,
      },
    });
  },

  async propose_create_team(args, ctx) {
    const name = String(args.name || '').trim();
    if (!name || name.length > 120) throw new ToolError('Team name must be 1 to 120 characters.');
    const project = args.project_key ? await projectByKey(ctx, args.project_key) : null;
    const lead = args.lead_email ? await userByEmail(ctx, args.lead_email) : null;
    const members = [];
    for (const email of new Set(args.member_emails || [])) {
      // Sequential on purpose: a short list, and each lookup fails with its own message.
      members.push(await userByEmail(ctx, email));
    }
    return proposal(ctx, {
      type: 'create_team',
      projectKey: project?.key ?? null,
      leadName: lead?.name ?? null,
      memberNames: members.map((member) => member.name),
      body: {
        name,
        project: project ? idOf(project) : null,
        lead: lead ? idOf(lead) : null,
        members: members.map(idOf),
      },
    });
  },

  async propose_client_brand(args, ctx) {
    const newName = args.new_name ? String(args.new_name).trim() : '';
    if (newName.length > 120) throw new ToolError('Client name must be at most 120 characters.');
    if (!args.client_name) {
      if (!newName) throw new ToolError('Ask what the new client company is called.');
      return proposal(ctx, { type: 'client_brand', clientId: null, currentName: null, name: newName, hasLogo: false });
    }
    const client = await clientByName(ctx, args.client_name);
    return proposal(ctx, {
      type: 'client_brand',
      clientId: idOf(client),
      currentName: client.name,
      name: newName || client.name,
      hasLogo: Boolean(client.logoUrl),
    });
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

    // A ticket is only useful to the team once it says where and how bad. Refuse
    // a draft that skips any of it, and hand back the valid choices to ask about.
    const modules = resolveProjectModules(project).map((module) => ({
      label: module.label,
      pages: (module.pages || []).map((page) => page.label),
    }));
    const chosenModule = modules.find((module) => module.label === args.module);
    const missing = [];
    if (modules.length && !args.module) missing.push(`module (one of: ${modules.map((m) => m.label).join(', ')})`);
    if (chosenModule?.pages.length && !args.page) missing.push(`page in ${chosenModule.label} (one of: ${chosenModule.pages.join(', ')})`);
    if (!args.category) missing.push(`category (${CATEGORIES.join(', ')})`);
    if (!args.severity) missing.push(`severity (${SEVERITIES.join(', ')})`);
    if (!args.priority) missing.push(`priority (${PRIORITIES.join(', ')})`);
    if (missing.length) {
      throw new ToolError(`Not drafted yet. Ask the user for: ${missing.join('; ')}. Ask one or two at a time and offer the choices.`);
    }
    try {
      assertModuleAndPage(project, args.module || undefined, args.page || undefined);
    } catch (err) {
      throw new ToolError(`${err.message}. Use exact labels from list_projects.`);
    }
    return proposal(ctx, {
      type: 'create_ticket',
      projectKey: project.key,
      // Lets the card offer module/page pickers so the user can correct the draft.
      modules,
      body: {
        project: String(project.id),
        title,
        description: clip(description, 5000),
        ...(args.steps_to_reproduce ? { stepsToReproduce: args.steps_to_reproduce } : {}),
        ...(args.module ? { module: args.module } : {}),
        ...(args.page ? { page: args.page } : {}),
        category: args.category,
        priority: args.priority,
        severity: args.severity,
        environment: args.environment || 'Staging',
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
  // The model only sees this user's tools, but a manipulated reply could still
  // name another one; the offer list is the permission check, so enforce it here.
  if (!toolsFor(ctx.user, ctx.permissionContext).some((tool) => tool.name === name)) {
    return { error: `${name} is not available to this user.` };
  }
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
