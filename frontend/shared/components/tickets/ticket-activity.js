import { stageLabel } from '@pms/shared';

/** stageHistory is the richer source for transitions — it carries decision and note. */
const TRANSITION_ACTIONS = new Set(['transitioned', 'reopened']);

/** Lower sorts first when timestamps tie. */
const SOURCE_PRIORITY = { stage: 0, activity: 1, comment: 2 };

const COLLAPSE_WINDOW_MS = 5 * 60 * 1000;

function actorOf(person) {
  return { name: person?.name || 'Someone' };
}

function idOf(entry, index, prefix) {
  const raw = entry?._id || entry?.id;
  return `${prefix}:${raw || index}`;
}

function timeOf(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function labelStage(key) {
  if (!key) return null;
  try {
    return stageLabel(key) || null;
  } catch {
    return null;
  }
}

/**
 * Schema keys are not user-facing language. A key with no entry here yields a
 * generic sentence rather than leaking the key itself.
 */
const FIELD_LABELS = {
  assignedTo: 'the assignee',
  team: 'the team',
  priority: 'priority',
  severity: 'severity',
  environment: 'environment',
  category: 'category',
  module: 'module',
  page: 'page',
  title: 'the title',
  description: 'the description',
  estimatedResolutionAt: 'the resolution estimate',
  expectedReleaseDate: 'the expected release',
  labels: 'labels',
};

const ID_LIKE = /^[a-f0-9]{24}$/i;

/**
 * `changes[]` values are heterogeneous by construction. assignTicket pushes
 * `{ from: ticket.assignedTo, to: assignedTo }` where `from` is a populated User
 * document and `to` is a raw ObjectId string, so naive interpolation renders
 * "[object Object]" and a 24-character id on the most common change in the system.
 * Anything not safely displayable resolves to null and the sentence omits it.
 */
function displayValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value.name || null;
  const str = String(value);
  if (ID_LIKE.test(str)) return null;
  if (str === '[object Object]') return null;
  return str;
}

function describeChange(change) {
  const label = FIELD_LABELS[change?.field];
  if (!label) return 'Updated this ticket';
  const from = displayValue(change.from);
  const to = displayValue(change.to);
  if (from && to) return `Changed ${label} from ${from} to ${to}`;
  if (to) return `Set ${label} to ${to}`;
  if (from) return `Cleared ${label}`;
  return `Changed ${label}`;
}

function fromActivity(entry, index) {
  const base = {
    at: timeOf(entry?.at),
    actor: actorOf(entry?.performedBy),
    detail: null,
    href: null,
    source: 'activity',
  };
  const changes = Array.isArray(entry?.changes) ? entry.changes : [];
  const id = idOf(entry, index, 'act');

  switch (entry?.action) {
    case 'created':
      return [{ ...base, id, kind: 'created', summary: 'Opened this ticket' }];
    case 'assigned': {
      const change = changes.find((c) => c?.field === 'assignedTo');
      if (!change) return [{ ...base, id, kind: 'change', summary: 'Changed the assignment' }];
      const to = displayValue(change.to);
      if (to) return [{ ...base, id, kind: 'change', summary: `Assigned to ${to}` }];
      // `to` present but unresolvable means a reassignment we cannot name.
      return [{
        ...base, id, kind: 'change',
        summary: change.to ? 'Changed the assignee' : 'Unassigned this ticket',
      }];
    }
    case 'updated':
      if (!changes.length) return [{ ...base, id, kind: 'change', summary: 'Updated this ticket' }];
      return changes.map((change, i) => ({
        ...base, id: `${id}#${i}`, kind: 'change', summary: describeChange(change),
      }));
    case 'attachments_added': {
      const n = changes.length || 1;
      return [{
        ...base, id, kind: 'file',
        summary: `Attached ${n} file${n === 1 ? '' : 's'}`,
      }];
    }
    case 'attachment_removed': {
      const name = displayValue(changes[0]?.from);
      return [{
        ...base, id, kind: 'file',
        summary: name ? `Removed ${name}` : 'Removed an attachment',
      }];
    }
    case 'blocked':
      return [{ ...base, id, kind: 'block', summary: 'Marked this blocked' }];
    case 'unblocked':
      return [{ ...base, id, kind: 'block', summary: 'Cleared the blocker' }];
    case 'comment_edited':
      return [{ ...base, id, kind: 'comment', summary: 'Edited a comment', href: 'discussion' }];
    case 'comment_deleted':
      return [{ ...base, id, kind: 'comment', summary: 'Deleted a comment' }];
    default:
      // Never surface a raw action name or an interpolated undefined.
      return [{ ...base, id, kind: 'change', summary: 'Updated this ticket' }];
  }
}

function fromStage(entry, index, skipInitial) {
  const to = labelStage(entry?.to);
  if (!to) return [];
  // ticket.service.js seeds every new ticket with a from-less stageHistory row
  // AND an activityLog `created` entry at the same timestamp. When activityLog
  // already records creation, the from-less stage row is a twin, not new
  // information — legacy tickets with no activityLog keep "Set to <stage>".
  if (skipInitial && !entry?.from) return [];
  const from = labelStage(entry?.from);
  return [{
    id: idOf(entry, index, 'stage'),
    at: timeOf(entry?.at),
    actor: actorOf(entry?.by),
    kind: 'stage',
    summary: from ? `Moved ${from} → ${to}` : `Set to ${to}`,
    detail: entry?.note || null,
    href: null,
    source: 'stage',
  }];
}

function fromComment(entry, index) {
  return [{
    id: idOf(entry, index, 'comment'),
    at: timeOf(entry?.createdAt),
    actor: actorOf(entry?.commentedBy),
    kind: 'comment',
    // The body never enters the feed — Discussion owns it.
    summary: 'Commented',
    detail: null,
    href: 'discussion',
    source: 'comment',
  }];
}

function mapAll(list, mapper) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((entry, index) => {
    try {
      out.push(...mapper(entry, index));
    } catch {
      // One malformed historical record must never blank the tab.
    }
  });
  return out;
}

function compare(a, b) {
  if (a.at !== b.at) {
    if (!a.at) return 1;
    if (!b.at) return -1;
    if (a.at > b.at) return -1;
    return 1;
  }
  const pa = SOURCE_PRIORITY[a.source] ?? 9;
  const pb = SOURCE_PRIORITY[b.source] ?? 9;
  if (pa !== pb) return pa - pb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Strictly consecutive same-actor `change` events inside the window fold into
 * one row. Siblings expanded from ONE `updated` entry (ids `act:a1#0`,
 * `act:a1#1`, sharing a parent and a timestamp) are exempt — the spec requires
 * one sentence per change for a single save, and without this exemption the
 * expansion would immediately re-collapse into "Made N changes".
 *
 * The exemption is a property of the PARENT GROUP, not of adjacency in the
 * run: comparing only against the accumulating run head (the previous
 * approach) lets a later sibling from a different multi-change parent slip
 * into an already-open run, splitting one save across two rows. Instead,
 * precompute how many `change` events share each parent id; any event whose
 * parent has more than one member can never be a collapse member or target.
 * Two same-parent singles cannot exist, so no parent-equality check is needed.
 */
const parentOf = (id) => String(id).split('#')[0];

function collapseRuns(events) {
  const parentCounts = new Map();
  for (const event of events) {
    if (event.kind !== 'change') continue;
    const parent = parentOf(event.id);
    parentCounts.set(parent, (parentCounts.get(parent) || 0) + 1);
  }
  const isExempt = (event) => event.kind === 'change' && parentCounts.get(parentOf(event.id)) > 1;

  const out = [];
  for (const event of events) {
    const prev = out[out.length - 1];
    const sameRun = prev
      && prev.kind === 'change'
      && event.kind === 'change'
      && !isExempt(prev)
      && !isExempt(event)
      && prev.actor.name === event.actor.name
      && prev.at && event.at
      && Math.abs(Date.parse(prev.at) - Date.parse(event.at)) <= COLLAPSE_WINDOW_MS;

    if (!sameRun) {
      out.push({ ...event });
      continue;
    }
    if (!prev.collapsed) prev.collapsed = [{ ...prev }];
    prev.collapsed.push({ ...event });
    prev.summary = `Made ${prev.collapsed.length} changes`;
  }
  return out;
}

export function buildActivityFeed(ticket) {
  const hasCreatedActivity = Array.isArray(ticket?.activityLog)
    && ticket.activityLog.some((e) => e?.action === 'created');

  const activity = mapAll(ticket?.activityLog, (entry, i) => (
    TRANSITION_ACTIONS.has(entry?.action) ? [] : fromActivity(entry, i)
  ));
  const stages = mapAll(ticket?.stageHistory, (entry, i) => fromStage(entry, i, hasCreatedActivity));
  const comments = mapAll(ticket?.comments, fromComment);

  return collapseRuns([...stages, ...activity, ...comments].sort(compare));
}
