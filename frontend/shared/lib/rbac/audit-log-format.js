import { BOARD_LABELS, ROLE_LABELS, stageLabel } from '@pms/shared';

/**
 * Audit rows are written by the backend as `<subject>.<verb>` enums. The table
 * shows the label; the raw enum stays available as a tooltip / filter value.
 */
export const AUDIT_ACTION_LABELS = Object.freeze({
  'role_matrix.update': 'Role matrix updated',
  'role_matrix.reset': 'Role matrix reset to baseline',
  'board_permissions.update': 'Board permissions updated',
  'board_permissions.reset': 'Board permissions reset to baseline',
  'user_overrides.update': 'User overrides updated',
  'scoped_assignment.create': 'Access granted',
  'scoped_assignment.update': 'Access updated',
  'scoped_assignment.revoke': 'Access revoked',
  'scoped_assignment.bulk_create': 'Bulk access granted',
  'scoped_assignment.bulk_revoke': 'Bulk access revoked',
  'scoped_assignment.company_sync': 'Company access synced',
  'scoped_assignment.project_testers_sync': 'Project testers updated',
  'security.impersonation.start': 'Impersonation started',
  'security.impersonation.stop': 'Impersonation ended',
  'user.update': 'User updated',
  'user.delete': 'User deleted',
  'user.reactivate': 'User reactivated',
  'whatsapp.linked': 'WhatsApp linked',
  'whatsapp.unlinked': 'WhatsApp unlinked',
  'whatsapp.link_blocked': 'WhatsApp link codes blocked',
  'whatsapp.unknown_sender': 'Unlinked number messaged',
  'whatsapp.ticket_created': 'Ticket filed from WhatsApp',
  'whatsapp.ticket_failed': 'WhatsApp ticket failed',
  'whatsapp.ticket_cancelled': 'WhatsApp ticket cancelled',
  'whatsapp.attach_added': 'Files attached from WhatsApp',
  'whatsapp.attach_failed': 'WhatsApp files not attached',
  'whatsapp.attach_cancelled': 'WhatsApp files cancelled',
  'whatsapp.attach_skipped': 'WhatsApp files skipped',
  'ticket.created': 'Ticket created',
  'ticket.updated': 'Ticket edited',
  'ticket.assigned': 'Ticket assigned',
  'ticket.transitioned': 'Stage changed',
  'ticket.blocked': 'Ticket blocked',
  'ticket.unblocked': 'Ticket unblocked',
  'ticket.comment_added': 'Comment added',
  'ticket.comment_edited': 'Comment edited',
  'ticket.comment_deleted': 'Comment deleted',
  'ticket.attachments_added': 'Files attached',
  'ticket.attachment_removed': 'File removed',
  'ticket.watched': 'Ticket watched',
  'ticket.unwatched': 'Ticket unwatched',
  'ticket.deleted': 'Ticket deleted',
});

export const AUDIT_CATEGORY_LABELS = Object.freeze({
  policy: 'Policy',
  access: 'Access',
  security: 'Security',
  whatsapp: 'WhatsApp',
  ticket: 'Tickets',
});

/** Same prefix rules as the backend's auditCategory, so a row's chip and its filter group agree. */
export function auditActionCategory(action) {
  if (action.startsWith('whatsapp.')) return 'whatsapp';
  if (action.startsWith('ticket.')) return 'ticket';
  if (action.startsWith('security.') || action.startsWith('user.')) return 'security';
  if (
    action.startsWith('role_matrix')
    || action.startsWith('user_overrides')
    || action.startsWith('board_permissions')
  ) return 'policy';
  return 'access';
}

/** Unknown enums still read as prose rather than as a raw identifier. */
export function formatAuditAction(action) {
  if (!action) return 'Unknown action';
  if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];
  const words = String(action).replace(/[._]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatAuditActor(actor) {
  if (!actor) return '—';
  if (typeof actor === 'string') return actor;
  return actor.name || actor.email || actor.id || '—';
}

/**
 * Muted line under the actor's name. Display names are not unique (the seeded admin is
 * literally named "Administrator"), so the email is what identifies the person.
 */
export function formatAuditActorDetail(actor) {
  if (!actor || typeof actor !== 'object') return null;
  if (!actor.name || !actor.email || actor.name === actor.email) return null;
  return actor.email;
}

export function auditInitiatorId(row) {
  const initiator = row?.initiator;
  if (!initiator) return null;
  if (typeof initiator === 'string') return initiator;
  return initiator.id || null;
}

export function auditActorId(row) {
  const actor = row?.actor;
  if (!actor) return null;
  if (typeof actor === 'string') return actor;
  return actor.id || null;
}

/** Show initiator only when it differs from the session actor (impersonation). */
export function formatAuditActorWithInitiator(row) {
  const actorLabel = formatAuditActor(row?.actor);
  const actorDetail = formatAuditActorDetail(row?.actor);
  const initiatorId = auditInitiatorId(row);
  const actorId = auditActorId(row);
  if (!initiatorId || (actorId && String(initiatorId) === String(actorId))) {
    return { actor: actorLabel, actorDetail, initiator: null };
  }
  return {
    actor: actorLabel,
    actorDetail,
    initiator: formatAuditActor(row.initiator),
  };
}

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

function listWithRemainder(items, shownCount = 2) {
  const shown = items.slice(0, shownCount);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} +${rest} more` : shown.join(', ');
}

/** Backend-resolved name first, then the raw id so the cell is never blank when a subject exists. */
function namedSubject(row, key, noun) {
  const details = row?.details || {};
  const name = row?.subjectNames?.[key] || details[`${key}Name`];
  if (name) return String(name);
  const id = details[`${key}Id`];
  return id ? `${noun} ${id}` : null;
}

function auditSubject(row) {
  const details = row?.details || {};
  const action = row?.action || '';

  if (action.startsWith('role_matrix.') || action.startsWith('board_permissions.')) {
    const changes = Array.isArray(details.changes) ? details.changes : [];
    let roles = [...new Set(changes.map((c) => c?.role).filter(Boolean))];
    // A save with no effective change has an empty diff; fall back to the subject it was saved for.
    if (!roles.length) {
      roles = Array.isArray(details.roles) ? details.roles.filter(Boolean) : [];
      if (!roles.length && details.role) roles = [details.role];
    }
    if (roles.length) return listWithRemainder(roles.map(roleLabel));
    if (details.board) return BOARD_LABELS[details.board] || String(details.board);
    return namedSubject(row, 'project', 'Project');
  }
  if (action === 'scoped_assignment.project_testers_sync') {
    return namedSubject(row, 'project', 'Project') || namedSubject(row, 'client', 'Company');
  }
  if (action.startsWith('scoped_assignment.bulk_') || action === 'scoped_assignment.company_sync') {
    return namedSubject(row, 'client', 'Company') || namedSubject(row, 'project', 'Project');
  }
  if (action.startsWith('whatsapp.')) {
    return details.waId ? `+${details.waId}` : null;
  }
  if (action.startsWith('ticket.')) {
    return row?.ticketId || details.ticketId || null;
  }
  if (action.startsWith('security.impersonation.')) {
    const id = details.targetId || details.targetUserId;
    return id ? `User ${id}` : null;
  }
  return null;
}

/**
 * The user account the event was about, or failing that the role, project,
 * company or phone number its details name.
 */
export function formatAuditTarget(row) {
  if (row?.targetUser) return formatAuditActor(row.targetUser);
  return auditSubject(row) || formatAuditActor(null);
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** "Developer +tickets.edit, Tester −teams.view" — first two, then a remainder count. */
function describeMatrixChanges(changes) {
  return listWithRemainder(changes.map(
    (c) => `${roleLabel(c.role)} ${c.after ? '+' : '−'}${c.permission ?? `${c.board}.${c.capability}`}`,
  ));
}

function describePermissionDelta(previous, next) {
  const before = new Set(Array.isArray(previous) ? previous : []);
  const after = new Set(Array.isArray(next) ? next : []);
  const added = [...after].filter((p) => !before.has(p));
  const removed = [...before].filter((p) => !after.has(p));
  const parts = [];
  if (added.length) parts.push(`+${added.join(', +')}`);
  if (removed.length) parts.push(`−${removed.join(', −')}`);
  return parts.length ? parts.join('  ') : 'No effective change';
}

function describeScope(details) {
  const scope = [];
  if (details.clientId) scope.push('client scope');
  if (details.projectId) scope.push('project scope');
  return scope.length ? scope.join(' + ') : 'global scope';
}

function describeBulkCounts(details) {
  const parts = [];
  if (details.createdCount != null) parts.push(`${details.createdCount} created`);
  if (details.revokedCount != null) parts.push(`${details.revokedCount} revoked`);
  if (details.addedCount != null) parts.push(`${details.addedCount} added`);
  if (details.reason) parts.push(details.reason.replace(/_/g, ' '));
  return parts.length ? parts.join(' · ') : 'Bulk assignment change';
}

const TICKET_FIELD_LABELS = {
  title: 'Title',
  description: 'Description',
  stepsToReproduce: 'Steps to reproduce',
  module: 'Module',
  page: 'Page',
  environment: 'Environment',
  category: 'Category',
  labels: 'Labels',
  severity: 'Severity',
  priority: 'Priority',
  testedBy: 'Tester',
  assignedTo: 'Assignee',
  team: 'Team',
  estimatedResolutionAt: 'Resolution estimate',
  expectedReleaseDate: 'Expected release',
};
const TICKET_PROSE_FIELDS = new Set(['description', 'stepsToReproduce']);
const TICKET_REF_FIELDS = new Set(['assignedTo', 'testedBy', 'team']);
const TICKET_DATE_FIELDS = new Set(['estimatedResolutionAt', 'expectedReleaseDate']);

function ticketFieldValue(change, side) {
  const value = change[side];
  if (TICKET_REF_FIELDS.has(change.field)) {
    if (!value) return 'nobody';
    return change[`${side}Label`] || 'a removed record';
  }
  if (value == null || value === '') return 'empty';
  if (TICKET_DATE_FIELDS.has(change.field)) return String(value).slice(0, 10);
  if (Array.isArray(value)) return value.join(', ');
  return String(value).replace(/_/g, ' ');
}

/** "Priority: high to urgent; Description edited" for the first two fields, then a count. */
function describeTicketChanges(changes) {
  const parts = changes.map((change) => {
    const label = TICKET_FIELD_LABELS[change.field] || change.field;
    if (TICKET_PROSE_FIELDS.has(change.field)) return `${label} edited`;
    return `${label}: ${ticketFieldValue(change, 'from')} to ${ticketFieldValue(change, 'to')}`;
  });
  const shown = parts.slice(0, 2).join('; ');
  const rest = parts.length - 2;
  return rest > 0 ? `${shown}; +${rest} more` : shown || 'No field changes';
}

function summariseTicketEvent(row) {
  const details = row?.details || {};
  const files = Array.isArray(details.files) ? details.files : [];
  const title = details.title ? `"${details.title}"` : 'ticket';
  const fromWhatsApp = details.via === 'whatsapp' ? ' from WhatsApp' : '';
  switch (row.action) {
    case 'ticket.created': return `Created ${title}${fromWhatsApp}`;
    case 'ticket.updated':
    case 'ticket.assigned':
      return describeTicketChanges(Array.isArray(details.changes) ? details.changes : []);
    case 'ticket.transitioned': {
      let move = `${stageLabel(details.from)} to ${stageLabel(details.to)}`;
      if (details.reopened) move += ' (reopened)';
      else if (details.closed) move += ' (closed)';
      return move;
    }
    case 'ticket.blocked': return details.reason ? `Blocked: ${details.reason}` : 'Blocked';
    case 'ticket.unblocked': return 'Blocker cleared';
    case 'ticket.comment_added': {
      const count = details.mentionCount || 0;
      const mentions = count ? `, mentioning ${count === 1 ? '1 person' : `${count} people`}` : '';
      return `${details.internal ? 'Internal comment' : 'Comment'} added${mentions}`;
    }
    case 'ticket.comment_edited': return `${details.internal ? 'Internal comment' : 'Comment'} edited`;
    case 'ticket.comment_deleted': return `${details.internal ? 'Internal comment' : 'Comment'} deleted`;
    case 'ticket.attachments_added':
      return files.length ? `Attached ${listWithRemainder(files)}${fromWhatsApp}` : `Files attached${fromWhatsApp}`;
    case 'ticket.attachment_removed': return files.length ? `Removed ${files.join(', ')}` : 'File removed';
    case 'ticket.watched': return 'Started watching';
    case 'ticket.unwatched': return 'Stopped watching';
    case 'ticket.deleted':
      return `Deleted ${title}${details.status ? ` while in ${stageLabel(details.status)}` : ''}`;
    default: return formatAuditAction(row.action);
  }
}

/** "WEB-12 · Web App · Priority: high to urgent". Project name when it still resolves, else the key. */
function summariseTicketRow(row) {
  const details = row?.details || {};
  const ticketId = row?.ticketId || details.ticketId;
  const project = row?.subjectNames?.project || details.projectKey;
  return [ticketId, project, summariseTicketEvent(row)].filter(Boolean).join(' · ');
}

/**
 * One human sentence per row. Never dumps raw JSON into the table — an
 * unrecognised shape falls back to the field names that changed.
 */
export function summariseAuditDetails(row) {
  const details = row?.details || {};
  const action = row?.action;

  if (action?.startsWith('ticket.')) return summariseTicketRow(row);

  if (action?.startsWith('whatsapp.')) {
    // Who said yes is the actor; this is which phone and what came of it.
    const number = details.waId ? `+${details.waId}` : 'a WhatsApp number';
    const from = `from ${number}`;
    const files = Array.isArray(details.files) ? details.files : [];
    const owner = row?.targetUser ? formatAuditActor(row.targetUser) : null;
    switch (action) {
      case 'whatsapp.linked': return `Linked ${number}`;
      case 'whatsapp.unlinked':
        return details.reason === 'replaced'
          ? `${number} unlinked from ${owner || 'an account'}: replaced by a new link`
          : `Unlinked ${number} from their profile`;
      case 'whatsapp.link_blocked':
        return `${plural(details.attempts || 5, 'wrong link code')} ${from}; linking paused for an hour`
          + `${owner ? `. The number is linked to ${owner}` : ''}`;
      case 'whatsapp.unknown_sender': {
        const kind = details.type ? `${details.type.charAt(0).toUpperCase()}${details.type.slice(1)}` : 'A';
        return `${kind} message ${from}, not linked to an account; no account data was sent`;
      }
      case 'whatsapp.ticket_created':
        return `${details.ticketId}: ${details.title}${files.length ? `, with ${plural(files.length, 'file')}` : ''} (${from})`;
      case 'whatsapp.ticket_failed': return `${details.title}: ${details.reason} (${from})`;
      case 'whatsapp.attach_added': return `${files.join(', ')} to ${details.ticketId} (${from})`;
      case 'whatsapp.attach_failed': return `${details.ticketId}: ${details.reason} (${from})`;
      case 'whatsapp.attach_cancelled': return `${files.join(', ')} for ${details.ticketId} (${from})`;
      case 'whatsapp.attach_skipped': return `${files.join(', ')} for ${details.ticketId || details.title} (${from})`;
      default: return `${details.title || details.ticketId || 'WhatsApp'} (${from})`;
    }
  }

  if (action === 'security.impersonation.start' || action === 'security.impersonation.stop') {
    const target = details.targetId || details.targetUserId;
    return target ? `Target user ${target}` : 'Impersonation session';
  }
  if (action === 'user.update' || action === 'user.reactivate' || action === 'user.delete') {
    const from = details.previous?.status;
    const to = details.next?.status;
    if (from && to && from !== to) return `Status ${from} → ${to}`;
    if (details.previous?.roles || details.next?.roles) {
      return describePermissionDelta(details.previous?.roles, details.next?.roles);
    }
    return 'User record changed';
  }
  if (
    action === 'scoped_assignment.bulk_create'
    || action === 'scoped_assignment.bulk_revoke'
    || action === 'scoped_assignment.company_sync'
    || action === 'scoped_assignment.project_testers_sync'
  ) {
    return describeBulkCounts(details);
  }
  if (details.matrixOmitted && details.changeCount != null) {
    return plural(details.changeCount, 'matrix field change');
  }
  if (Array.isArray(details.changes) && details.changes.length) {
    return describeMatrixChanges(details.changes);
  }
  if (details.changeCount != null) {
    return details.changeCount === 0
      ? 'No effective change'
      : plural(details.changeCount, 'permission change');
  }
  if (action === 'user_overrides.update') {
    return describePermissionDelta(details.previous, details.next);
  }
  if (action === 'scoped_assignment.create') {
    return `${roleLabel(details.role)} on ${describeScope(details)}`;
  }
  if (action === 'scoped_assignment.revoke') {
    return details.next?.reason || details.previous?.reason || 'No reason given';
  }
  if (action === 'scoped_assignment.update') {
    const from = details.previous?.status;
    const to = details.next?.status;
    if (from && to && from !== to) return `Status ${from} → ${to}`;
    return details.next?.expiresAt ? `Expires ${details.next.expiresAt.slice(0, 10)}` : 'Assignment edited';
  }
  if (details.role) return roleLabel(details.role);
  if (details.previous && !details.next) return 'Reset to baseline';

  const keys = Object.keys(details);
  return keys.length ? `Changed: ${keys.join(', ')}` : '—';
}

/** Absolute timestamp for the cell, relative for the muted second line. */
const RELATIVE_DIVISIONS = [
  [60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'],
  [4.35, 'week'], [12, 'month'], [Infinity, 'year'],
];

export function formatAuditTimestamp(iso, now = Date.now()) {
  const ms = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(ms)) return { absolute: '—', relative: '', iso: '' };

  const date = new Date(ms);
  const absolute = date.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  let value = (ms - now) / 1000;
  let unit = 'second';
  for (const [size, name] of RELATIVE_DIVISIONS) {
    unit = name;
    if (Math.abs(value) < size) break;
    value /= size;
  }
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    .format(Math.round(value), unit);

  return { absolute, relative, iso: date.toISOString() };
}
