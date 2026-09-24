import { randomUUID } from 'node:crypto';
import {
  ADMIN_ROLES, CATEGORIES, DEFAULT_NOTIFICATION_PREFS, ENVIRONMENTS, ESTIMATE_DATE_EDITOR_ROLES, EXTERNAL_ACCEPTANCE_PERMISSION, PRIORITIES,
  NOTIFICATION_EVENTS, PEOPLE_ASSIGNABLE_ROLES, ROLE_IDS, SEVERITIES, STAGES, STAGE_KEYS,
  can, canAccessRoute, canEditTicket, hasAnyRole, isExternalUser, isTicketOverdue, notificationEventLabel, resolveProjectModules, stageIndex, stageLabel,
} from '@pms/shared';
import { buildTicketFilter, getTicket, listTickets } from '../tickets/ticket.service.js';
import Ticket from '../tickets/ticket.model.js';
import { allowedTransitions, checkGuards, previewTransition } from '../tickets/transition.service.js';
import { assertModuleAndPage, listProjects } from '../projects/project.service.js';
import { listClients } from '../clients/client.service.js';
import { listTeams } from '../teams/team.service.js';
import { listUsers } from '../users/user.service.js';
import { listProjectTeamMembers } from '../projects/project-team-member.service.js';
import { computeDelivery, computeTimeInStage, dashboard as analyticsDashboard } from '../tickets/analytics.service.js';
import { ANALYTICS_ROLES } from '../tickets/analytics.access.js';

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

/** Tickets scanned for recent comments: the most recently updated ones. */
const RECENT_TICKETS = 25;
const RECENT_COMMENTS = 40;

const RECENT_COMMENTS_TOOL = fn(
  'recent_comments',
  'The latest discussion comments across a project (or all the user\'s projects), newest first, with the ticket each '
    + 'belongs to. Use it for "what\'s new in the comments", "any updates on WEB", "what did the client say this week".',
  {
    project_key: nullable({ type: 'string', description: 'Project key; null for every project the user can see.' }),
    days: nullable({ type: 'integer', description: 'How far back, 1 to 30. Null for 7.' }),
    only_unread: nullable({ type: 'boolean', description: 'True for only tickets with replies this user has not read.' }),
  },
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

const GET_NOTIFICATION_SETTINGS = fn(
  'get_notification_settings',
  "The user's own notification settings: for each event, whether it reaches them in the app and by email.",
  {},
);

const PROPOSE_NOTIFICATION_SETTINGS = fn(
  'propose_notification_settings',
  "Draft a change to the user's own notification settings. The user must confirm. Pass only the events that "
    + 'change, with null for a channel that stays as it is; or restore_defaults true (and changes null) to reset them all.',
  {
    changes: {
      type: ['array', 'null'],
      items: {
        type: 'object',
        properties: {
          event: { type: 'string', enum: [...NOTIFICATION_EVENTS] },
          in_app: { type: ['boolean', 'null'] },
          email: { type: ['boolean', 'null'] },
        },
        required: ['event', 'in_app', 'email'],
        additionalProperties: false,
      },
    },
    restore_defaults: nullable({ type: 'boolean' }),
  },
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
  'Draft changes to a ticket\'s fields. The user must confirm. Use null for fields that stay the same. '
    + 'For assignment use propose_assign; for Blocked use propose_block.',
  {
    ticket_id: TICKET_ID,
    title: nullable({ type: 'string' }),
    description: nullable({ type: 'string', description: 'The full new description, 10 to 5000 characters.' }),
    steps_to_reproduce: nullable({ type: 'string' }),
    priority: nullableEnum(PRIORITIES),
    severity: nullableEnum(SEVERITIES),
    category: nullableEnum(CATEGORIES),
    environment: nullableEnum(ENVIRONMENTS),
    module: nullable({ type: 'string' }),
    page: nullable({ type: 'string' }),
    due_date: nullable({ type: 'string', description: 'Estimated resolution date, YYYY-MM-DD.' }),
    release_date: nullable({ type: 'string', description: 'Expected release date, YYYY-MM-DD (not before the resolution date).' }),
  },
);

const PROPOSE_COMMENT = fn(
  'propose_comment',
  'Draft a comment or reply on a ticket\'s discussion, written as the user. The user must confirm.',
  {
    ticket_id: TICKET_ID,
    text: { type: 'string', description: 'The comment, in the user\'s words and language.' },
    internal: nullable({ type: 'boolean', description: 'True for a team-only note clients can\'t see. Internal users only.' }),
    mention: {
      type: ['array', 'null'],
      items: { type: 'string' },
      description: 'Names of people on this ticket to @mention (e.g. the person being replied to); null for none.',
    },
  },
);

const PROPOSE_ASSIGN = fn(
  'propose_assign',
  'Draft assigning one or more tickets to a person on the project team, or unassigning them. The user must confirm.',
  {
    ticket_ids: { type: 'array', items: TICKET_ID, description: 'One ticket, or several for a bulk change (at most 50).' },
    assignee: nullable({ type: 'string', description: 'Name or email of the person; null to unassign.' }),
  },
);

const PROPOSE_BLOCK = fn(
  'propose_block',
  'Draft marking a ticket Blocked (with the reason) or clearing Blocked. The user must confirm.',
  {
    ticket_id: TICKET_ID,
    blocked: { type: 'boolean' },
    reason: nullable({ type: 'string', description: 'What it is waiting on. Required when blocking.' }),
  },
);

const WATCH_TICKET = fn(
  'watch_ticket',
  'Start or stop watching a ticket (notifications about it), right away.',
  { ticket_id: TICKET_ID, watch: { type: 'boolean' } },
);

const PROPOSE_ATTACH = fn(
  'propose_attach_files',
  'Draft attaching the user\'s files to a ticket, with an optional comment. The card carries the files the user '
    + 'added ([Files ready to attach] notes) and lets them add more; nothing uploads until they confirm. Only call it '
    + 'once the ticket is certain: both the ticket id and its project must be right, or it is refused.',
  {
    ticket_id: TICKET_ID,
    project_key: { type: 'string', description: 'Key of the project the ticket belongs to, e.g. WEB.' },
    note: nullable({ type: 'string', description: 'Optional comment posted with the files.' }),
  },
);

/** Guard failures a move card can fix by setting the estimate dates itself. */
const DATE_GUARDS = new Set(['ESTIMATES_REQUIRED', 'INVALID_ESTIMATE_DATES']);

/** Most tickets one stage-move card may carry. */
const MAX_STAGE_BATCH = 50;

const PROPOSE_STAGE = fn(
  'propose_stage_change',
  'Draft moving one ticket, or several at once, to a stage. One card covers them all; the user must confirm. '
    + 'Each ticket is checked against this user\'s stage rules; ones that can\'t move are left off with the reason.',
  {
    ticket_ids: { type: 'array', items: TICKET_ID, description: `One ticket, or up to ${MAX_STAGE_BATCH} to move together.` },
    to_stage: { type: 'string', enum: [...STAGE_KEYS] },
    note: nullable({ type: 'string', description: 'Note for the stage history; the reason when closing.' }),
    due_date: nullable({
      type: 'string',
      description: 'Estimated resolution date to set first, YYYY-MM-DD. Later stages need it; null keeps the current one.',
    }),
    release_date: nullable({
      type: 'string',
      description: 'Expected release date to set first, YYYY-MM-DD. Later stages need it; null keeps the current one.',
    }),
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
  ui_qa: { path: '/ui-qa', label: 'UI & QA' },
  audit_log: { path: '/audit-log', label: 'RBAC audit log' },
  user_roles: { path: '/settings/rbac-preview/matrix', label: 'User roles' },
  notification_settings: { path: '/settings/notifications', label: 'Notification settings' },
  projects: { path: '/projects', label: 'Projects' },
  teams: { path: '/teams', label: 'Teams' },
  users: { path: '/users', label: 'Users' },
  profile: { path: '/profile', label: 'Profile' },
});

/** The tabs of the ticket drawer, in the order the drawer shows them. */
export const TICKET_TABS = Object.freeze(['discussion', 'details', 'attachments', 'history', 'qa']);

const NAVIGATE = fn(
  'navigate',
  'Open a page for the user right away: go to a page, open a ticket (optionally on a tab), or switch the open '
    + 'ticket to another tab. ticket_id and ticket_tab only apply to destination "ticket"; null otherwise. '
    + 'To filter the ticket list use set_ticket_filters.',
  {
    destination: { type: 'string', enum: Object.keys(DESTINATIONS) },
    ticket_id: nullable(TICKET_ID),
    ticket_tab: nullableEnum(TICKET_TABS),
  },
);

/** "any" clears a filter; null leaves it as it is on screen. */
const ANY = 'any';

/** Same role and status choices as the People page's own filters. */
const PEOPLE_ROLES = [...PEOPLE_ASSIGNABLE_ROLES, ROLE_IDS.SUPER_ADMIN];
const PEOPLE_STATUSES = ['invited', 'active', 'inactive', 'deleted'];

const SET_PEOPLE_FILTERS = fn(
  'set_people_filters',
  'Change the search and filters on the People page, right away (it opens the page if needed), so the user sees '
    + 'the people there. Only what you pass changes; null leaves it as it is, "any" clears it.',
  {
    search: nullable({ type: 'string', description: 'Name or email to search for; "any" clears the search.' }),
    role: nullableEnum([...PEOPLE_ROLES, ANY]),
    status: nullableEnum([...PEOPLE_STATUSES, ANY]),
    rows: { type: ['integer', 'null'], enum: [25, 50, 100, null], description: 'Rows per page.' },
  },
);

/** The Tickets table's sortable columns (ticket-table.jsx). */
const TICKET_SORT_COLUMNS = ['ticketId', 'title', 'status', 'owner', 'inStage', 'estimatedDone', 'discussionUnread'];

/**
 * The other pages whose filters live in their URL: each field maps to one URL
 * param, and only the fields listed for a page apply to it.
 */
const FILTER_PAGES = Object.freeze({
  board: { path: '/tickets/board', label: 'Board', fields: ['mine'] },
  projects: { path: '/projects', label: 'Projects', fields: ['search', 'rows'] },
  teams: { path: '/teams', label: 'Teams', fields: ['search', 'team_scope', 'team_status', 'rows'] },
  notifications: { path: '/notifications', label: 'Notifications', fields: ['unread'] },
  analytics: {
    path: '/tickets/analytics',
    label: 'Analytics',
    fields: ['trend_group_by', 'throughput_group_by', 'window_days', 'breakdown'],
  },
  audit_log: { path: '/audit-log', label: 'RBAC audit log', fields: ['audit_category', 'audit_action', 'audit_order', 'rows'] },
});
const PAGE_ROWS = [20, 50, 100];

const SET_PAGE_FILTERS = fn(
  'set_page_filters',
  'Change the filters on another page, right away (it opens the page if needed). Tickets and People have their own '
    + 'tools. Fields per page: board: mine (true = only my tickets, false = everyone). projects: search, rows. '
    + 'teams: search, team_scope, team_status, rows. notifications: unread. analytics: trend_group_by, '
    + 'throughput_group_by, window_days (7-90), breakdown. audit_log: audit_category, audit_action (e.g. '
    + 'role_matrix.update), audit_order, rows. Pass null for every field you are not changing; "any" clears a text or choice.',
  {
    page: { type: 'string', enum: Object.keys(FILTER_PAGES) },
    search: nullable({ type: 'string' }),
    mine: nullable({ type: 'boolean' }),
    unread: nullable({ type: 'boolean', description: 'true = unread only.' }),
    team_scope: nullableEnum(['all', 'global', 'project', 'empty']),
    team_status: nullableEnum(['active', 'archived']),
    trend_group_by: nullableEnum(['day', 'week']),
    throughput_group_by: nullableEnum(['day', 'week']),
    window_days: nullable({ type: 'integer', description: 'Throughput window in days, 7 to 90.' }),
    breakdown: nullableEnum(['severity', 'module', 'assignee', 'team', 'priority', 'category', 'environment', 'label']),
    audit_category: nullableEnum(['policy', 'access', 'security', ANY]),
    audit_action: nullable({ type: 'string' }),
    audit_order: nullableEnum(['newest', 'oldest']),
    rows: { type: ['integer', 'null'], enum: [20, 50, 100, null], description: 'Rows per page.' },
  },
);

const MODULE_VIEW = fn(
  'control_module_view',
  "Work the Tickets page's By module view, right away (it switches to that view if needed): collapse or expand "
    + 'module cards, show all or only the first few tickets in them ("show more"/"show fewer"), and order the cards '
    + 'A-Z ("name") or by what needs attention. modules null means every module; otherwise module names as on the '
    + 'cards ("No module" for tickets without one). except gets the opposite: "collapse all but Master Catalog" is '
    + 'action collapse, modules null, except ["Master Catalog"] (it stays open), all in one call.',
  {
    action: nullableEnum(['collapse', 'expand', 'show_all', 'show_fewer']),
    modules: { type: ['array', 'null'], items: { type: 'string' } },
    except: { type: ['array', 'null'], items: { type: 'string' } },
    order: nullableEnum(['name', 'attention']),
  },
);

const SET_TICKET_FILTERS = fn(
  'set_ticket_filters',
  'Change the filters on the Tickets page, right away (it opens the page if needed). Only the filters you pass '
    + 'change; null leaves one as it is on screen. Use "any" to clear a filter ("any stage", "any priority"), '
    + 'false to turn a toggle off, and clear_all true to reset everything first.',
  {
    stage: nullableEnum([...STAGE_KEYS, ANY]),
    priority: nullableEnum([...PRIORITIES, ANY]),
    category: nullableEnum([...CATEGORIES, ANY]),
    severity: nullableEnum([...SEVERITIES, ANY]),
    scope: nullableEnum(['all', 'assigned', 'reported', 'unassigned']),
    owner: nullable({ type: 'string', description: 'Owner\'s name as shown in the Owner filter, or "any".' }),
    module: nullable({ type: 'string', description: 'Exact module label, or "any".' }),
    search: nullable({ type: 'string', description: 'Search box text; "" clears it.' }),
    blocked: nullable({ type: 'boolean' }),
    overdue: nullable({ type: 'boolean' }),
    reopened: nullable({ type: 'boolean' }),
    new_reply: nullable({ type: 'boolean' }),
    view: nullableEnum(['table', 'modules']),
    sort_by: nullableEnum(TICKET_SORT_COLUMNS),
    sort_direction: nullableEnum(['asc', 'desc']),
    rows: { type: ['integer', 'null'], enum: [25, 50, 100, null], description: 'Rows per page.' },
    clear_all: nullable({ type: 'boolean' }),
  },
);

const BREAKDOWNS = ['severity', 'module', 'assignee', 'team', 'priority', 'category', 'environment', 'label'];

const GET_ANALYTICS = fn(
  'get_analytics',
  'Run the Analytics page numbers for a project (or all projects): tickets per stage and lane, blocked and overdue, '
    + 'estimate accuracy, reopens after QA, ticket age, lead and cycle time, time spent in each stage (and the '
    + 'bottleneck), weekly created vs closed, and a breakdown by one dimension. Filters narrow the tickets counted.',
  {
    project_key: nullable({ type: 'string', description: 'Project key, e.g. WEB; null for all of the user\'s projects.' }),
    breakdown: nullableEnum(BREAKDOWNS),
    window_days: nullable({ type: 'integer', description: 'Days of throughput to count, 7 to 90 (default 30).' }),
    stage: nullableEnum(STAGE_KEYS),
    priority: nullableEnum(PRIORITIES),
    severity: nullableEnum(SEVERITIES),
    category: nullableEnum(CATEGORIES),
    module: nullable({ type: 'string', description: 'Exact module label.' }),
  },
);

const CREATE_REPORT = fn(
  'create_project_report',
  'Build a status report for one project over a period (default the last 7 days): where tickets stand, what was '
    + 'created and finished in the period, what is overdue or blocked, the bottleneck stage, and open tickets per '
    + 'owner. It is shown to the user as a report card they can download as a document.',
  {
    project_key: { type: 'string', description: 'Project key, e.g. WEB.' },
    days: nullable({ type: 'integer', description: 'Report on the last N days, 1 to 90 (default 7).' }),
    from: nullable({ type: 'string', description: 'Period start, YYYY-MM-DD; use with to instead of days.' }),
    to: nullable({ type: 'string', description: 'Period end, YYYY-MM-DD (inclusive).' }),
  },
);

const DOWNLOAD_REPORT = fn(
  'download_report',
  'Download the latest report in this chat as a document (the user asked to download, save or export it).',
  {},
);

const SCROLL_PAGE = fn(
  'scroll_page',
  'Scroll the page the user is on, right away: "down"/"up" by about a screen, or to the "top"/"bottom".',
  { direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'] } },
);

const CHANGE_PAGE = fn(
  'change_page',
  'Move the list the user is looking at (Tickets, People, Projects or Teams) to another page of results, right away: "next", '
    + '"previous", "first", "last", or "number" with page_number. page_number only applies to "number"; null otherwise.',
  {
    direction: { type: 'string', enum: ['next', 'previous', 'first', 'last', 'number'] },
    page_number: nullable({ type: 'integer', description: 'Page to open, from 1.' }),
  },
);

const SWITCH_PROJECT = fn(
  'switch_project',
  'Change which project the app shows (the project switcher at the top), right away. '
    + 'project_key null means "All projects" (internal users only).',
  { project_key: nullable({ type: 'string', description: 'Key from the project list, e.g. WEB.' }) },
);

/** Tools offered to this user. Proposals they could never confirm aren't offered. */
export function toolsFor(user, permissionContext) {
  const external = isExternalUser(user);
  const allowed = (permission) => !external && can(user, permission, permissionContext);
  const tools = [
    SEARCH_TICKETS, GET_TICKET, GET_DISCUSSION, RECENT_COMMENTS_TOOL, OPEN_ATTACHMENT, LIST_PROJECTS, NAVIGATE, SCROLL_PAGE, CHANGE_PAGE, SET_PAGE_FILTERS, MODULE_VIEW, SWITCH_PROJECT,
    SET_TICKET_FILTERS, GET_NOTIFICATION_SETTINGS, PROPOSE_NOTIFICATION_SETTINGS,
  ];
  if (external || can(user, 'tickets.create', permissionContext)) tools.push(PROPOSE_CREATE);
  // Commenting and attaching need only ticket access, as on their REST routes.
  if (can(user, 'tickets.view', permissionContext) || external) tools.push(PROPOSE_COMMENT, PROPOSE_ATTACH);
  if (allowed('tickets.view')) tools.push(WATCH_TICKET);
  if (allowed('tickets.edit')) tools.push(PROPOSE_UPDATE, PROPOSE_ASSIGN, PROPOSE_BLOCK);
  // Stage moves: admins (who may move anything), internal users who work the board, or
  // clients allowed to close Live tickets. Each move is still checked against the
  // stage rules (previewTransition) before a card is drafted.
  const mayMoveStages = external
    ? can(user, EXTERNAL_ACCEPTANCE_PERMISSION, permissionContext)
    : hasAnyRole(user, ...ADMIN_ROLES) || can(user, 'boards.use', permissionContext);
  if (mayMoveStages) tools.push(PROPOSE_STAGE);
  // Same gates as the REST routes these mirror; the user directory is admin-only there too.
  const admin = !external && hasAnyRole(user, ...ADMIN_ROLES);
  if (admin) tools.push(SEARCH_USERS, SET_PEOPLE_FILTERS);
  // Same gate as the analytics REST routes (analytics.access.js).
  if (!external && hasAnyRole(user, ...ANALYTICS_ROLES)) tools.push(GET_ANALYTICS, CREATE_REPORT, DOWNLOAD_REPORT);
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

/**
 * The projects this user can see, as key and name. Given to the model up front
 * so a spoken or half-remembered reference ("test final", "TS4") can be matched
 * to a real project key, and to the transcriber as vocabulary.
 */
export async function projectRoster(ctx) {
  try {
    return (await projectsFor(ctx)).map((project) => ({ key: project.key, name: project.name }));
  } catch {
    return []; // no project access: nothing to match against
  }
}

async function projectsFor(ctx) {
  ctx.projects ??= (await listProjects({ limit: 100 }, ctx.user, ctx.permissionContext)).results;
  return ctx.projects;
}

const NO_MODULE = 'No module';

/**
 * Module names the user can see: each accessible project's modules, plus names
 * already on its tickets (a module renamed since still shows on the page).
 * ponytail: across all accessible projects, not just the one in the switcher.
 */
async function moduleNamesFor(ctx) {
  if (!ctx.moduleNames) {
    const projects = await projectsFor(ctx);
    const configured = projects.flatMap((project) => resolveProjectModules(project).map((module) => module.label));
    const used = await Ticket.distinct('module', { project: { $in: projects.map(idOf) } });
    ctx.moduleNames = [...new Set([...configured, ...used].map((name) => String(name ?? '').trim()).filter(Boolean))];
  }
  return ctx.moduleNames;
}

/** The names as the page spells them; an unknown one fails with the real list, so it can be corrected. */
async function knownModules(ctx, names) {
  const known = [...await moduleNamesFor(ctx), NO_MODULE];
  const matched = [];
  const unknown = [];
  for (const name of names) {
    const hit = known.find((label) => label.toLowerCase() === String(name).trim().toLowerCase());
    if (hit) matched.push(hit);
    else unknown.push(name);
  }
  if (unknown.length) {
    throw new ToolError(`No module named ${unknown.map((name) => `"${name}"`).join(', ')}. `
      + `Modules: ${known.slice(0, 60).join(', ')}. If one of these is what the user meant, use it; otherwise ask.`);
  }
  return matched;
}

async function projectByKey(ctx, key) {
  const wanted = String(key || '').trim().toUpperCase();
  const project = (await projectsFor(ctx)).find((p) => String(p.key).toUpperCase() === wanted);
  if (!project) throw new ToolError(`No accessible project with key "${key}". Call list_projects.`);
  return project;
}

class ToolError extends Error {}

const MAX_REPORT_DAYS = 90;

/** The report's period: from/to when given (to inclusive), else the last `days` days up to now. */
function reportPeriod(args) {
  const to = args.to ? new Date(`${args.to}T23:59:59.999Z`) : new Date();
  const days = Math.min(MAX_REPORT_DAYS, Math.max(1, args.days ?? 7));
  const from = args.from ? new Date(`${args.from}T00:00:00.000Z`) : new Date(to.getTime() - days * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new ToolError('Use dates like 2026-09-01.');
  if (from > to) throw new ToolError('The period starts after it ends.');
  if (to - from > MAX_REPORT_DAYS * 86400000) throw new ToolError(`Keep the period to ${MAX_REPORT_DAYS} days or less.`);
  return { from, to };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The estimate dates a draft would set on `ticket` (only the ones that change),
 * checked as the API checks them: real YYYY-MM-DD days, an allowed role, and a
 * release not before the resolution.
 */
function estimateDateChanges(ctx, ticket, { due, release }) {
  const changes = {};
  for (const [field, value, label] of [
    ['estimatedResolutionAt', due, 'estimated resolution date'],
    ['expectedReleaseDate', release, 'expected release date'],
  ]) {
    if (value == null) continue;
    if (!ISO_DAY.test(value) || Number.isNaN(Date.parse(value))) throw new ToolError(`Give the ${label} as YYYY-MM-DD.`);
    if (value !== day(ticket[field])) changes[field] = value;
  }
  if (!Object.keys(changes).length) return changes;
  if (!hasAnyRole(ctx.user, ...ESTIMATE_DATE_EDITOR_ROLES)) {
    throw new ToolError('Only admins, project admins and developers can change estimate dates.');
  }
  // The API's ticket-edit rule too: admins, project admins, or the ticket's reporter or owner.
  if (!canEditTicket(ctx.user, ticket)) {
    throw new ToolError(`This user can't edit ${ticket.ticketId}'s dates: only admins, project admins, its reporter or its owner can.`);
  }
  const resolution = changes.estimatedResolutionAt ?? day(ticket.estimatedResolutionAt);
  const releaseDay = changes.expectedReleaseDate ?? day(ticket.expectedReleaseDate);
  if (resolution && releaseDay && releaseDay < resolution) {
    throw new ToolError(`The release date (${releaseDay}) can't be before the resolution date (${resolution}).`);
  }
  return changes;
}

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

/** One of the user's notification settings; unset ones are the defaults, as on the settings page. */
function notificationSetting(user, channel, event) {
  const prefs = user.notificationPrefs?.[channel];
  return prefs?.get?.(event) ?? prefs?.[event] ?? DEFAULT_NOTIFICATION_PREFS[channel][event];
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
      // Stages this user could move it to right now (board rules, required dates, their role).
      you_can_move_to: (await allowedTransitions(ctx.user, ticket.ticketId, ctx.permissionContext)).map(stageLabel),
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

  async recent_comments(args, ctx) {
    const days = Math.min(30, Math.max(1, Number(args.days) || 7));
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const query = { page: 1, limit: RECENT_TICKETS, sortBy: 'updatedAt:desc' };
    if (args.project_key) query.project = idOf(await projectByKey(ctx, args.project_key));
    if (args.only_unread) query.newReply = true;
    // Same access-checked list and ticket reads as the app, so clients only get
    // their own tickets and never internal notes.
    // ponytail: scans the 25 most recently updated tickets; a comments index if projects get busier.
    const page = await listTickets(ctx.user, query, ctx.permissionContext);
    const recent = page.results.filter((ticket) => new Date(ticket.updatedAt).getTime() >= since);
    const comments = [];
    for (const summary of recent) {
      // Sequential on purpose: at most 25 reads, each access-checked on its own.
      const ticket = await getTicket(ctx.user, summary.ticketId, ctx.permissionContext);
      for (const comment of ticket.comments || []) {
        if (new Date(comment.createdAt).getTime() < since) continue;
        comments.push({
          ticket: ticket.ticketId,
          ticket_title: ticket.title,
          stage: stageLabel(ticket.status),
          by: comment.commentedBy?.name ?? null,
          at: comment.createdAt ? new Date(comment.createdAt).toISOString().slice(0, 16).replace('T', ' ') : null,
          internal: Boolean(comment.internal),
          files: (comment.attachments || []).length,
          text: clip(comment.content, 500),
        });
      }
    }
    comments.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return {
      since: day(since),
      tickets_checked: recent.length,
      total: comments.length,
      comments: comments.slice(0, RECENT_COMMENTS),
      ...(comments.length > RECENT_COMMENTS ? { note: `Showing the newest ${RECENT_COMMENTS}; narrow by project or days for more.` } : {}),
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

  async get_notification_settings(_args, ctx) {
    return NOTIFICATION_EVENTS.map((event) => ({
      event,
      label: notificationEventLabel(event),
      in_app: notificationSetting(ctx.user, 'inApp', event),
      email: notificationSetting(ctx.user, 'email', event),
    }));
  },

  async propose_notification_settings(args, ctx) {
    const wanted = args.restore_defaults
      ? NOTIFICATION_EVENTS.map((event) => ({
        event, in_app: DEFAULT_NOTIFICATION_PREFS.inApp[event], email: DEFAULT_NOTIFICATION_PREFS.email[event],
      }))
      : args.changes || [];
    // Only real changes go on the card, each with where it stands now.
    const settings = [];
    for (const { event, in_app: inApp, email } of wanted) {
      const setting = { event, label: notificationEventLabel(event) };
      for (const [channel, to] of [['inApp', inApp], ['email', email]]) {
        const from = notificationSetting(ctx.user, channel, event);
        if (to != null && to !== from) setting[channel] = { from, to };
      }
      if (setting.inApp || setting.email) settings.push(setting);
    }
    if (!settings.length) {
      throw new ToolError(args.restore_defaults
        ? 'The settings are already the defaults.'
        : 'Those settings are already that way; nothing to change.');
    }
    return proposal(ctx, { type: 'notification_settings', settings, ...(args.restore_defaults ? { reset: true } : {}) });
  },

  async get_analytics(args, ctx) {
    const project = args.project_key ? await projectByKey(ctx, args.project_key) : null;
    const query = {
      ...(project ? { project: String(project.id) } : {}),
      ...(args.stage ? { status: args.stage } : {}),
      ...(args.priority ? { priority: args.priority } : {}),
      ...(args.severity ? { severity: args.severity } : {}),
      ...(args.category ? { category: args.category } : {}),
      ...(args.module ? { module: args.module } : {}),
      trendGroupBy: 'week',
      deliveryGroupBy: 'week',
      windowDays: args.window_days ?? 30,
      dimension: args.breakdown || 'severity',
    };
    const data = await analyticsDashboard(ctx.user, query);
    const stages = (byStage) => Object.fromEntries(Object.entries(byStage)
      .map(([stage, value]) => [stageLabel(stage), value]));
    // Stages nobody has passed through yet say nothing; leave them out.
    const timeInStage = Object.fromEntries(Object.entries(data.timeInStage.byStage)
      .filter(([, value]) => value.count)
      .map(([stage, value]) => [stageLabel(stage), value]));
    return {
      project: project ? `${project.name} (${project.key})` : 'All projects',
      tickets: data.ticketCount,
      ...(data.exceedsCeiling ? { note: `Over ${data.ceiling} tickets; numbers may be partial.` } : {}),
      by_lane: data.overview.lanes,
      by_stage: stages(data.overview.byStage),
      blocker_or_critical: data.overview.blockerCritical,
      estimates: data.overview.estimates.buckets,
      reopened_after_qa: data.overview.reopens,
      open_ticket_age_days: data.overview.aging,
      delivery: {
        window_days: data.delivery.windowDays,
        ...data.delivery.summary,
        lead_time: data.delivery.leadTime,
        cycle_time: data.delivery.cycleTime,
        live_and_closed_by_week: data.delivery.throughput,
      },
      time_in_stage_hours: timeInStage,
      bottleneck: data.timeInStage.bottleneck ? stageLabel(data.timeInStage.bottleneck) : null,
      // ponytail: last 12 weeks is plenty for a spoken summary; the page has the full chart.
      created_vs_closed_by_week: data.trend.points.slice(-12),
      breakdown: { by: data.drill.dimension, rows: data.drill.rows.slice(0, 15) },
    };
  },

  async create_project_report(args, ctx) {
    const project = await projectByKey(ctx, args.project_key);
    const { from, to } = reportPeriod(args);
    const filter = await buildTicketFilter(ctx.user, { project: String(project.id) }, ctx.permissionContext);
    // ponytail: loads the project's tickets in memory like analytics does (its ceiling is 10k tickets);
    // move the period counts into an aggregation if projects grow past that.
    const tickets = await Ticket.find(filter)
      .select('ticketId title status priority blocked blockerReason estimatedResolutionAt createdAt closedAt stageHistory assignedTo')
      .populate('assignedTo', 'name')
      .lean();
    const inPeriod = (date) => date && new Date(date) >= from && new Date(date) <= to;
    const brief = (ticket) => ({
      id: ticket.ticketId, title: clip(ticket.title, 120), stage: stageLabel(ticket.status), priority: ticket.priority,
    });
    const LIST = 15;
    const open = tickets.filter((ticket) => ticket.status !== 'closed');
    const created = tickets.filter((ticket) => inPeriod(ticket.createdAt));
    // Finished: went Live or was closed in the period.
    const finished = tickets.filter((ticket) => inPeriod(ticket.closedAt)
      || (ticket.stageHistory || []).some((entry) => entry.to === 'live' && inPeriod(entry.at)));
    const overdue = open.filter((ticket) => isTicketOverdue(ticket));
    const blocked = open.filter((ticket) => ticket.blocked);
    const owners = new Map();
    for (const ticket of open) {
      const name = ticket.assignedTo?.name || 'Unassigned';
      owners.set(name, (owners.get(name) || 0) + 1);
    }
    const byStage = new Map();
    for (const ticket of tickets) byStage.set(ticket.status, (byStage.get(ticket.status) || 0) + 1);
    const timeInStage = computeTimeInStage(tickets);
    const delivery = computeDelivery(tickets, { windowDays: 90 });
    const report = {
      project: { key: project.key, name: project.name },
      from: day(from),
      to: day(to),
      totals: {
        tickets: tickets.length,
        open: open.length,
        created: created.length,
        finished: finished.length,
        overdue: overdue.length,
        blocked: blocked.length,
      },
      by_stage: STAGE_KEYS.filter((key) => byStage.get(key)).map((key) => ({ stage: stageLabel(key), count: byStage.get(key) })),
      bottleneck: timeInStage.bottleneck
        ? { stage: stageLabel(timeInStage.bottleneck), median_hours: timeInStage.byStage[timeInStage.bottleneck].medianHours }
        : null,
      lead_time_median_hours: delivery.leadTime.medianHours,
      cycle_time_median_hours: delivery.cycleTime.medianHours,
      created_tickets: created.slice(0, LIST).map(brief),
      finished_tickets: finished.slice(0, LIST).map(brief),
      overdue_tickets: overdue.slice(0, LIST).map((ticket) => ({
        ...brief(ticket), owner: ticket.assignedTo?.name || 'Unassigned', due: day(ticket.estimatedResolutionAt),
      })),
      blocked_tickets: blocked.slice(0, LIST).map((ticket) => ({
        ...brief(ticket), reason: ticket.blockerReason ? clip(ticket.blockerReason, 200) : null,
      })),
      open_by_owner: [...owners.entries()].map(([name, count]) => ({ name, open: count }))
        .sort((a, b) => b.open - a.open).slice(0, 10),
    };
    ctx.actions.push({ id: randomUUID(), type: 'report', report });
    return {
      status: 'shown',
      note: 'The report card is on screen and can be downloaded. Reply with a short summary: the few things that '
        + 'matter most (progress, risks, who is overloaded). Don\'t read the lists out.',
      report,
    };
  },

  async download_report(_args, ctx) {
    ctx.actions.push({ id: randomUUID(), type: 'report_download' });
    return { status: 'downloading', note: 'The latest report in this chat is downloading as a document.' };
  },

  async set_people_filters(args, ctx) {
    const filters = {};
    if (typeof args.search === 'string') filters.search = args.search.trim().slice(0, 100);
    if ([...PEOPLE_ROLES, ANY].includes(args.role)) filters.role = args.role;
    if ([...PEOPLE_STATUSES, ANY].includes(args.status)) filters.status = args.status;
    if ([25, 50, 100].includes(args.rows)) filters.limit = String(args.rows);
    if (!Object.keys(filters).length) throw new ToolError('Pass a search, role or status to change.');
    ctx.actions.push({ id: randomUUID(), type: 'people_filters', ...filters });
    return { status: 'filtered', ...filters };
  },

  async set_page_filters(args, ctx) {
    const target = FILTER_PAGES[args.page];
    if (!target) throw new ToolError(`Unknown page ${args.page}.`);
    if (!canAccessRoute(target.path, ctx.user, ctx.permissionContext)) {
      throw new ToolError(`The user doesn't have access to ${target.label}. Say so plainly.`);
    }
    const stray = Object.keys(args).filter((key) => key !== 'page' && args[key] != null && !target.fields.includes(key));
    if (stray.length) throw new ToolError(`${target.label} has no ${stray.join(', ')} filter; it has ${target.fields.join(', ')}.`);
    const given = target.fields.filter((field) => args[field] != null);
    if (!given.length) throw new ToolError(`Pass one of ${target.fields.join(', ')}.`);
    // Field -> [URL param, value]; a null value removes the param (the page's default).
    const text = (value) => {
      const v = String(value).trim().slice(0, 100);
      return v && v !== ANY ? v : null;
    };
    const toParam = {
      search: ['search', text],
      mine: ['mine', (v) => (v ? '1' : null)],
      unread: ['unread', (v) => (v ? '1' : null)],
      team_scope: ['scope', (v) => (v === 'all' ? null : v)],
      team_status: ['status', (v) => (v === 'archived' ? v : null)],
      trend_group_by: ['trendGroupBy', (v) => (v === 'week' ? v : null)],
      throughput_group_by: ['deliveryGroupBy', (v) => (v === 'week' ? v : null)],
      window_days: ['windowDays', (v) => String(Math.max(7, Math.min(90, Math.round(Number(v)) || 30)))],
      breakdown: ['dimension', (v) => v],
      audit_category: ['category', text],
      audit_action: ['action', text],
      audit_order: ['sortBy', (v) => (v === 'oldest' ? 'createdAt:asc' : null)],
      rows: ['limit', (v) => (PAGE_ROWS.includes(v) ? String(v) : null)],
    };
    const params = Object.fromEntries(given.map((field) => [toParam[field][0], toParam[field][1](args[field])]));
    ctx.actions.push({ id: randomUUID(), type: 'page_filters', path: target.path, params });
    return { status: 'applied', page: target.label, note: 'The page now shows these filters. Say what changed in a few words.' };
  },

  async control_module_view(args, ctx) {
    if (!canAccessRoute('/tickets', ctx.user, ctx.permissionContext)) {
      throw new ToolError("The user doesn't have access to the Tickets page.");
    }
    const action = ['collapse', 'expand', 'show_all', 'show_fewer'].includes(args.action) ? args.action : null;
    const order = ['name', 'attention'].includes(args.order) ? args.order : null;
    if (!action && !order) throw new ToolError('Pass an action (collapse, expand, show_all, show_fewer) or an order.');
    const names = (list) => (Array.isArray(list)
      ? list.map((name) => String(name).trim().slice(0, 100)).filter(Boolean).slice(0, 50)
      : null);
    let modules = names(args.modules);
    if (modules && !modules.length) throw new ToolError('Name at least one module, or pass modules null for all.');
    let except = names(args.except);
    if (modules) modules = await knownModules(ctx, modules);
    if (except?.length) except = await knownModules(ctx, except);
    ctx.actions.push({
      id: randomUUID(), type: 'module_view', action, modules, order, ...(except?.length ? { except } : {}),
    });
    return { status: 'applied', note: 'The module view now shows this. Say what changed in a few words.' };
  },

  async scroll_page(args, ctx) {
    const direction = ['down', 'up', 'top', 'bottom'].includes(args.direction) ? args.direction : 'down';
    ctx.actions.push({ id: randomUUID(), type: 'scroll', direction });
    return { status: 'scrolled', direction };
  },

  async change_page(args, ctx) {
    const direction = ['next', 'previous', 'first', 'last', 'number'].includes(args.direction) ? args.direction : 'next';
    if (direction === 'number' && !(Number.isInteger(args.page_number) && args.page_number >= 1)) {
      throw new ToolError('Give page_number (1 or more) with direction "number".');
    }
    ctx.actions.push({
      id: randomUUID(), type: 'change_page', direction, ...(direction === 'number' ? { page: args.page_number } : {}),
    });
    return { status: 'changed', direction };
  },

  async navigate(args, ctx) {
    const destination = DESTINATIONS[args.destination];
    if (!destination) throw new ToolError(`Unknown destination ${args.destination}.`);
    // The same page rules the app's route guard and sidebar use.
    if (!canAccessRoute(destination.path, ctx.user, ctx.permissionContext)) {
      throw new ToolError(`The user doesn't have access to ${destination.label}. Say so plainly; don't open it.`);
    }
    let href = destination.path;
    let { label } = destination;
    if (args.destination === 'ticket') {
      if (!args.ticket_id) throw new ToolError('Say which ticket to open.');
      const ticket = await getTicket(ctx.user, args.ticket_id, ctx.permissionContext);
      href = `/tickets?ticket=${encodeURIComponent(ticket.ticketId)}`;
      label = ticket.ticketId;
      // The QA report tab is internal-only; clients just get the ticket.
      const tab = args.ticket_tab === 'qa' && isExternalUser(ctx.user) ? null : args.ticket_tab;
      if (tab) {
        href += `&tab=${tab}`;
        label = `${ticket.ticketId} (${tab === 'qa' ? 'QA report' : tab})`;
      }
    }
    ctx.actions.push({ id: randomUUID(), type: 'navigate', href, label });
    return { status: 'opened', page: label };
  },

  async set_ticket_filters(args, ctx) {
    if (!canAccessRoute('/tickets', ctx.user, ctx.permissionContext)) {
      throw new ToolError('The user doesn\'t have access to the Tickets page.');
    }
    // Keys are the ticket list's own filter names (ticket-preferences.js); '' is "any".
    const filters = {};
    const pick = (key, value) => {
      if (value == null) return;
      filters[key] = value === ANY ? '' : value;
    };
    pick('status', args.stage);
    pick('priority', args.priority);
    pick('category', args.category);
    pick('severity', args.severity);
    pick('scope', args.scope);
    if (args.module != null && args.module !== ANY) [filters.module] = await knownModules(ctx, [args.module]);
    else pick('module', args.module);
    if (args.search != null) filters.q = String(args.search).trim().slice(0, 200);
    for (const [key, value] of [['blocked', args.blocked], ['overdue', args.overdue],
      ['reopened', args.reopened], ['newReply', args.new_reply]]) {
      if (value != null) filters[key] = Boolean(value);
    }
    // The owner filter takes an id the page knows; it matches the name among its owners.
    const owner = args.owner == null ? undefined : (args.owner === ANY ? '' : String(args.owner).trim());
    if (owner === '') filters.assignedTo = '';
    ctx.actions.push({
      id: randomUUID(),
      type: 'ticket_filters',
      filters,
      ...(owner ? { ownerName: owner } : {}),
      ...(args.clear_all ? { reset: true } : {}),
      ...(args.view ? { view: args.view } : {}),
      ...(TICKET_SORT_COLUMNS.includes(args.sort_by)
        ? { sort: { column: args.sort_by, direction: args.sort_direction === 'asc' ? 'asc' : 'desc' } } : {}),
      ...([25, 50, 100].includes(args.rows) ? { limit: args.rows } : {}),
    });
    return { status: 'applied', note: 'The Tickets page now shows these filters. Say what changed in a few words.' };
  },

  async switch_project(args, ctx) {
    if (!args.project_key) {
      // Clients always work inside one of their projects; the switcher has no "All" for them.
      if (isExternalUser(ctx.user)) throw new ToolError('Clients work in one project at a time. Ask which one.');
      ctx.actions.push({ id: randomUUID(), type: 'switch_project', projectId: null, label: 'All projects' });
      return { status: 'switched', project: 'All projects' };
    }
    // Only projects the switcher would list for this user.
    const project = await projectByKey(ctx, args.project_key);
    ctx.actions.push({
      id: randomUUID(), type: 'switch_project', projectId: idOf(project), label: `${project.key} ${project.name}`,
    });
    return { status: 'switched', project: `${project.key} ${project.name}` };
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
    const current = {
      ...ticket,
      estimatedResolutionAt: day(ticket.estimatedResolutionAt),
      expectedReleaseDate: day(ticket.expectedReleaseDate),
    };
    const wanted = {
      title: args.title,
      description: args.description,
      stepsToReproduce: args.steps_to_reproduce,
      priority: args.priority,
      severity: args.severity,
      category: args.category,
      environment: args.environment,
      module: args.module,
      page: args.page,
    };
    const changes = {};
    for (const [field, value] of Object.entries(wanted)) {
      if (value != null && value !== current[field]) changes[field] = value;
    }
    Object.assign(changes, estimateDateChanges(ctx, ticket, { due: args.due_date, release: args.release_date }));
    if (!Object.keys(changes).length) throw new ToolError('Nothing would change. Ask what should be different.');
    // Checked here too, so the card never fails on confirm.
    if (changes.title && (changes.title.trim().length < 5 || changes.title.length > 200)) {
      throw new ToolError('Title must be 5 to 200 characters.');
    }
    if (changes.description && changes.description.trim().length < 10) {
      throw new ToolError('Description must be at least 10 characters.');
    }
    return proposal(ctx, {
      type: 'update_ticket',
      ticketId: ticket.ticketId,
      title: ticket.title,
      from: Object.fromEntries(Object.keys(changes).map((field) => [field, current[field] ?? null])),
      changes,
    });
  },

  async propose_comment(args, ctx) {
    const ticket = await getTicket(ctx.user, args.ticket_id, ctx.permissionContext);
    const text = String(args.text || '').trim();
    if (!text) throw new ToolError('Ask what the comment should say.');
    if (text.length > 10000) throw new ToolError('Comments can be at most 10000 characters.');
    const internal = Boolean(args.internal);
    if (internal && isExternalUser(ctx.user)) throw new ToolError('Clients can\'t post internal notes.');
    // Mentions: only people already on this ticket (reporter, owner, anyone in its discussion).
    const people = new Map();
    for (const person of [ticket.createdBy, ticket.assignedTo, ...(ticket.comments || []).map((c) => c.commentedBy)]) {
      if (person?.name && idOf(person) && idOf(person) !== idOf(ctx.user)) people.set(idOf(person), person.name);
    }
    const mentioned = [];
    for (const name of args.mention || []) {
      const wanted = String(name).trim().toLowerCase();
      const matches = [...people].filter(([, full]) => full.toLowerCase().includes(wanted));
      if (matches.length !== 1) {
        throw new ToolError(matches.length
          ? `"${name}" matches ${matches.map(([, full]) => full).join(', ')}. Ask which one.`
          : `No one called "${name}" is on ${ticket.ticketId}. People on it: ${[...people.values()].join(', ') || 'none'}.`);
      }
      mentioned.push({ id: matches[0][0], name: matches[0][1] });
    }
    // The app links a mention by its "@Full Name" text plus the id, as the comment box does.
    const missing = mentioned.filter((person) => !text.includes(`@${person.name}`));
    const content = [...missing.map((person) => `@${person.name}`), text].join(' ');
    if (content.length > 10000) throw new ToolError('Comments can be at most 10000 characters.');
    return proposal(ctx, {
      type: 'comment',
      ticketId: ticket.ticketId,
      title: ticket.title,
      content,
      internal,
      mentions: mentioned.map((person) => person.id),
    });
  },

  async propose_assign(args, ctx) {
    const ids = [...new Set((args.ticket_ids || []).map((id) => String(id).trim().toUpperCase()).filter(Boolean))];
    if (!ids.length) throw new ToolError('Say which ticket to assign.');
    if (ids.length > 50) throw new ToolError('At most 50 tickets at a time.');
    const tickets = [];
    for (const id of ids) {
      // Sequential on purpose: each lookup is access-checked and fails on its own.
      tickets.push(await getTicket(ctx.user, id, ctx.permissionContext));
    }
    let person = null;
    if (args.assignee) {
      // Only people on each ticket's project team can be assigned (same rule as the API).
      const wanted = String(args.assignee).trim().toLowerCase();
      const projectIds = [...new Set(tickets.map((ticket) => idOf(ticket.project)))];
      const rosters = await Promise.all(projectIds.map((id) => listProjectTeamMembers(id)));
      const candidates = new Map();
      for (const row of rosters[0]) {
        const { user } = row;
        const matches = user.email?.toLowerCase() === wanted || user.name?.toLowerCase().includes(wanted);
        const onEvery = rosters.every((roster) => roster.some((other) => other.user.id === user.id));
        if (matches && onEvery) candidates.set(user.id, user);
      }
      const found = [...candidates.values()];
      if (!found.length) {
        const names = [...new Set(rosters.flat().map((row) => row.user.name))].slice(0, 30);
        throw new ToolError(`No one called "${args.assignee}" is on the project team${projectIds.length > 1 ? ' of every one of these tickets' : ''}. `
          + `Team members: ${names.join(', ') || 'none'}.`);
      }
      if (found.length > 1) {
        throw new ToolError(`"${args.assignee}" matches ${found.map((user) => `${user.name} (${user.email})`).join(', ')}. Ask which one.`);
      }
      [person] = found;
    }
    return proposal(ctx, {
      type: 'assign',
      ticketIds: tickets.map((ticket) => ticket.ticketId),
      from: tickets.map((ticket) => ticket.assignedTo?.name ?? null),
      assigneeId: person?.id ?? null,
      assigneeName: person?.name ?? null,
    });
  },

  async propose_block(args, ctx) {
    const ticket = await getTicket(ctx.user, args.ticket_id, ctx.permissionContext);
    if (args.blocked === Boolean(ticket.blocked)) {
      throw new ToolError(`${ticket.ticketId} is already ${ticket.blocked ? 'blocked' : 'not blocked'}.`);
    }
    const reason = String(args.reason || '').trim();
    if (args.blocked && !reason) throw new ToolError('Ask what the ticket is blocked on, then draft again with the reason.');
    return proposal(ctx, {
      type: 'block',
      ticketId: ticket.ticketId,
      title: ticket.title,
      blocked: args.blocked,
      ...(args.blocked ? { reason: clip(reason, 2000) } : {}),
    });
  },

  async watch_ticket(args, ctx) {
    const ticket = await getTicket(ctx.user, args.ticket_id, ctx.permissionContext);
    ctx.actions.push({ id: randomUUID(), type: 'watch', ticketId: ticket.ticketId, watch: Boolean(args.watch) });
    return { status: args.watch ? 'watching' : 'stopped watching', ticket: ticket.ticketId };
  },

  async propose_attach_files(args, ctx) {
    // Verify both halves, so files never land on a look-alike ticket in another project.
    const project = await projectByKey(ctx, args.project_key);
    const ticket = await getTicket(ctx.user, args.ticket_id, ctx.permissionContext);
    if (idOf(ticket.project) !== idOf(project)) {
      throw new ToolError(`${ticket.ticketId} ("${ticket.title}") is in project ${ticket.project?.key ?? 'another project'}, `
        + `not ${project.key}. Tell the user and ask which one they meant before drafting.`);
    }
    const note = String(args.note || '').trim();
    return {
      ...proposal(ctx, {
        type: 'attach_files',
        ticketId: ticket.ticketId,
        projectKey: project.key,
        title: ticket.title,
        ...(note ? { note: clip(note, 10000) } : {}),
      }),
      verified: { ticket: ticket.ticketId, title: ticket.title, project: `${project.key} ${project.name}` },
      note: 'A card shows the files, ticket and project; nothing is uploaded until the user confirms.',
    };
  },

  async propose_stage_change(args, ctx) {
    const ids = [...new Set((args.ticket_ids || []).map((id) => String(id).trim().toUpperCase()).filter(Boolean))];
    if (!ids.length) throw new ToolError('Say which ticket to move.');
    if (ids.length > MAX_STAGE_BATCH) throw new ToolError(`At most ${MAX_STAGE_BATCH} tickets at a time.`);
    const movable = [];
    const skipped = [];
    let needsReason = false;
    let needsNote = false;
    for (const id of ids) {
      // Sequential on purpose: each ticket is access-checked and judged on its own.
      let ticket;
      try {
        ticket = await getTicket(ctx.user, id, ctx.permissionContext);
      } catch (err) {
        if (err?.statusCode !== 403 && err?.statusCode !== 404) throw err;
        skipped.push({ ticket: id, reason: 'Not found, or no access.' });
        continue;
      }
      // Same checks as the real move, so the user never gets a card that fails on confirm.
      let check = await previewTransition(ctx.user, ticket.ticketId, args.to_stage, ctx.permissionContext);
      // Missing or bad estimate dates are the last check; if this card sets them, judge the move with them in place.
      const dates = estimateDateChanges(ctx, ticket, { due: args.due_date, release: args.release_date });
      if (!check.ok && DATE_GUARDS.has(check.code) && Object.keys(dates).length) {
        const guard = checkGuards(args.to_stage, { ...ticket, ...dates });
        check = guard.ok
          ? {
            ok: true,
            needsReason: args.to_stage === 'closed',
            needsNote: stageIndex(args.to_stage) < stageIndex(ticket.status),
          }
          : guard;
      }
      if (!check.ok) {
        skipped.push({
          ticket: ticket.ticketId,
          reason: check.reason,
          ...(DATE_GUARDS.has(check.code)
            ? { fix: 'Offer to set them: ask for the dates, then draft again with due_date and release_date.' }
            : {}),
        });
        continue;
      }
      needsReason ||= check.needsReason;
      needsNote ||= check.needsNote;
      movable.push({ ...ticket, dates });
    }
    if (!movable.length) {
      if (ids.length === 1) {
        const options = skipped[0].reason === 'Not found, or no access.'
          ? []
          : (await allowedTransitions(ctx.user, ids[0], ctx.permissionContext)).map(stageLabel);
        throw new ToolError(`${skipped[0].reason} ${skipped[0].fix ?? ''} ${options.length
          ? `Right now this user can move ${ids[0]} to: ${options.join(', ')}.`
          : `This user can't move ${ids[0]} there.`}`.replace(/\s+/g, ' '));
      }
      throw new ToolError(`None of these can move to ${stageLabel(args.to_stage)}: `
        + `${skipped.map((entry) => `${entry.ticket} (${entry.reason})`).join('; ')}`);
    }
    if ((needsReason || needsNote) && !args.note) {
      throw new ToolError(needsReason
        ? 'Closing needs a reason. Ask the user why, then draft again with it as the note.'
        : 'Moving a ticket back needs a note. Ask the user what is wrong, then draft again with it as the note.');
    }
    const one = movable.length === 1 ? movable[0] : null;
    const result = proposal(ctx, {
      type: 'stage_change',
      // A single ticket keeps the one-ticket shape the card and history notes use.
      ...(one
        ? { ticketId: one.ticketId, title: one.title, from: one.status }
        : { ticketIds: movable.map((ticket) => ticket.ticketId), froms: movable.map((ticket) => ticket.status) }),
      // Estimate dates set just before the move (the same for every ticket on the card).
      ...(movable.some((ticket) => Object.keys(ticket.dates).length)
        ? { dates: { due: args.due_date ?? null, release: args.release_date ?? null } }
        : {}),
      to: args.to_stage,
      ...(args.note ? { note: args.note } : {}),
      // Closing takes the note as its reason.
      ...(needsReason ? { asReason: true } : {}),
    });
    return skipped.length
      ? { ...result, left_off: skipped, tell_user: 'Say which tickets were left off the card and why.' }
      : result;
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
