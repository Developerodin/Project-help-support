import { QA_STATUS_LABELS } from '@pms/shared';

const COMMENT_PREVIEW_LEN = 100;

function actorOf(person) {
  return { name: person?.name || 'Someone' };
}

function timeOf(value) {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function truncatePreview(text) {
  if (!text) return null;
  const clean = String(text).trim();
  if (!clean) return null;
  if (clean.length <= COMMENT_PREVIEW_LEN) return clean;
  return `${clean.slice(0, COMMENT_PREVIEW_LEN).trimEnd()}…`;
}

function compare(a, b) {
  if (a.at !== b.at) {
    if (!a.at) return 1;
    if (!b.at) return -1;
    if (a.at > b.at) return -1;
    return 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function buildUiQaActivityFeed(data = {}) {
  const events = [];

  for (const [index, entry] of (data.qaStatusHistory || []).entries()) {
    const from = QA_STATUS_LABELS[entry.from] || entry.from || '—';
    const to = QA_STATUS_LABELS[entry.to] || entry.to || '—';
    events.push({
      id: entry.id || entry._id || `status-${index}`,
      at: timeOf(entry.at),
      actor: actorOf(entry.changedBy || entry.by),
      kind: 'stage',
      summary: entry.from ? `Moved ${from} → ${to}` : `Set to ${to}`,
      detail: entry.note || null,
      href: null,
      changes: [],
      commentPreview: null,
    });
  }

  for (const [index, comment] of (data.comments || []).entries()) {
    events.push({
      id: comment._id || comment.id || `comment-${index}`,
      at: timeOf(comment.createdAt || comment.editedAt),
      actor: actorOf(comment.commentedBy),
      kind: 'comment',
      summary: 'Commented',
      commentPreview: truncatePreview(comment.content),
      detail: null,
      href: 'discussion',
      changes: [],
    });
  }

  for (const [index, file] of (data.attachments || []).entries()) {
    events.push({
      id: file.id || file._id || `file-${index}`,
      at: timeOf(file.uploadedAt || file.createdAt),
      actor: actorOf(file.uploadedBy),
      kind: 'file',
      summary: `Attached ${file.name}`,
      detail: null,
      href: null,
      changes: [],
      commentPreview: null,
    });
  }

  return events.sort(compare);
}
