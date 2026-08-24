import { ROLE_LABELS } from '@pms/shared';

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
});

export const AUDIT_CATEGORY_LABELS = Object.freeze({
  policy: 'Policy',
  access: 'Access',
});

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

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** "Developer +tickets.edit, Tester −teams.view" — first two, then a remainder count. */
function describeMatrixChanges(changes) {
  const shown = changes.slice(0, 2).map(
    (c) => `${roleLabel(c.role)} ${c.after ? '+' : '−'}${c.permission}`,
  );
  const rest = changes.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} +${rest} more` : shown.join(', ');
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

/**
 * One human sentence per row. Never dumps raw JSON into the table — an
 * unrecognised shape falls back to the field names that changed.
 */
export function summariseAuditDetails(row) {
  const details = row?.details || {};
  const action = row?.action;

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
