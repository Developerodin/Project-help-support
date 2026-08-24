export function formatAuditActor(actor) {
  if (!actor) return '—';
  if (typeof actor === 'string') return actor;
  return actor.name || actor.email || actor.id || '—';
}

export function summariseAuditDetails(row) {
  const details = row.details || {};
  if (details.changeCount != null) return `${details.changeCount} matrix change(s)`;
  if (details.previous && details.next) return 'Updated assignment';
  if (details.role) return `Role: ${details.role}`;
  if (details.previous && !details.next) return 'Policy reset';
  return Object.keys(details).length ? JSON.stringify(details) : '—';
}
