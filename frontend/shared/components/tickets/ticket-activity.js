import { stageLabel } from '@pms/shared';
import { formatDateOnly } from './ticket-drawer-utils.js';

/** stageHistory is the richer source for transitions — it carries decision and note. */
const TRANSITION_ACTIONS = new Set(['transitioned', 'reopened']);

/** Lower sorts first when timestamps tie. */
const SOURCE_PRIORITY = { stage: 0, activity: 1, comment: 2 };

const DATE_FIELDS = new Set(['estimatedResolutionAt', 'expectedReleaseDate']);
const ID_LIKE = /^[a-f0-9]{24}$/i;
const COMMENT_PREVIEW_LEN = 100;

const FIELD_LABELS = {
  assignedTo: 'Assignee',
  team: 'Team',
  priority: 'Priority',
  severity: 'Severity',
  environment: 'Environment',
  category: 'Category',
  module: 'Module',
  page: 'Page',
  title: 'Title',
  description: 'Description',
  estimatedResolutionAt: 'Resolution estimate',
  expectedReleaseDate: 'Expected release',
  labels: 'Labels',
};

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

function normalizeForCompare(value, field) {
  if (value == null || value === '') return null;
  if (DATE_FIELDS.has(field) || value instanceof Date) {
    const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
    if (!Number.isNaN(ms)) return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if (value.name) return value.name;
    if (value._id) return String(value._id);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return JSON.stringify([...value].sort());
  return String(value).toLowerCase();
}

function isNoOpChange(change) {
  if (!change?.field) return true;
  return normalizeForCompare(change.from, change.field) === normalizeForCompare(change.to, change.field);
}

function filterNoOpChanges(changes) {
  if (!Array.isArray(changes)) return [];
  return changes.filter((change) => !isNoOpChange(change));
}

function formatValue(value, field) {
  if (value == null || value === '') return null;
  if (DATE_FIELDS.has(field)) {
    const ms = value instanceof Date ? value.getTime() : Date.parse(String(value));
    if (!Number.isNaN(ms)) return formatDateOnly(new Date(ms).toISOString());
  }
  if (typeof value === 'object') return value.name || null;
  const str = String(value);
  if (ID_LIKE.test(str)) return null;
  if (str === '[object Object]') return null;
  return str;
}

function toChangeEntry(change) {
  const label = FIELD_LABELS[change?.field];
  if (!label) return null;
  return {
    label,
    from: formatValue(change.from, change.field),
    to: formatValue(change.to, change.field),
  };
}

function buildChanges(changes) {
  return filterNoOpChanges(changes).map(toChangeEntry).filter(Boolean);
}

function updateSummary(changeCount) {
  if (changeCount <= 1) return 'Updated ticket';
  return `Updated ticket · ${changeCount} changes`;
}

function truncatePreview(text) {
  if (!text) return null;
  const clean = String(text).trim();
  if (!clean) return null;
  if (clean.length <= COMMENT_PREVIEW_LEN) return clean;
  return `${clean.slice(0, COMMENT_PREVIEW_LEN).trimEnd()}…`;
}

function fromActivity(entry, index) {
  const base = {
    at: timeOf(entry?.at),
    actor: actorOf(entry?.performedBy),
    detail: null,
    href: null,
    source: 'activity',
    changes: [],
    commentPreview: null,
  };
  const rawChanges = Array.isArray(entry?.changes) ? entry.changes : [];
  const id = idOf(entry, index, 'act');

  switch (entry?.action) {
    case 'created':
      return [{ ...base, id, kind: 'created', summary: 'Opened this ticket' }];
    case 'assigned': {
      const change = rawChanges.find((c) => c?.field === 'assignedTo');
      const changes = buildChanges(change ? [change] : []);
      const to = change ? formatValue(change.to, 'assignedTo') : null;
      let summary;
      if (to) summary = `Assigned to ${to}`;
      else if (change?.to) summary = 'Changed the assignee';
      else summary = 'Unassigned this ticket';
      return [{
        ...base,
        id,
        kind: 'update',
        summary,
        changes,
        collapsed: changes.length > 0,
      }];
    }
    case 'updated': {
      const changes = buildChanges(rawChanges);
      if (!changes.length) return [];
      return [{
        ...base,
        id,
        kind: 'update',
        summary: updateSummary(changes.length),
        changes,
        collapsed: changes.length > 0,
      }];
    }
    case 'attachments_added': {
      const n = filterNoOpChanges(rawChanges).length || rawChanges.length || 1;
      return [{
        ...base,
        id,
        kind: 'file',
        summary: `Attached ${n} file${n === 1 ? '' : 's'}`,
      }];
    }
    case 'attachment_removed': {
      const name = formatValue(rawChanges[0]?.from, 'attachment');
      return [{
        ...base,
        id,
        kind: 'file',
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
      return [{ ...base, id, kind: 'update', summary: 'Updated ticket' }];
  }
}

function fromStage(entry, index, skipInitial) {
  const to = labelStage(entry?.to);
  if (!to) return [];
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
    changes: [],
    commentPreview: null,
  }];
}

function fromComment(entry, index) {
  return [{
    id: idOf(entry, index, 'comment'),
    at: timeOf(entry?.createdAt),
    actor: actorOf(entry?.commentedBy),
    kind: 'comment',
    summary: 'Commented',
    commentPreview: truncatePreview(entry?.content),
    detail: null,
    href: 'discussion',
    source: 'comment',
    changes: [],
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

export function buildActivityFeed(ticket) {
  const hasCreatedActivity = Array.isArray(ticket?.activityLog)
    && ticket.activityLog.some((e) => e?.action === 'created');

  const activity = mapAll(ticket?.activityLog, (entry, i) => (
    TRANSITION_ACTIONS.has(entry?.action) ? [] : fromActivity(entry, i)
  ));
  const stages = mapAll(ticket?.stageHistory, (entry, i) => fromStage(entry, i, hasCreatedActivity));
  const comments = mapAll(ticket?.comments, fromComment);

  return [...stages, ...activity, ...comments].sort(compare);
}
