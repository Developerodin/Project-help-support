export function dateValue(iso) {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '';
}

export function daysBetween(from, to = Date.now()) {
  return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86400000);
}

export function formatWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateOnly(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function stageAgeDays(ticket) {
  const last = ticket.stageHistory?.[ticket.stageHistory.length - 1]?.at
    || ticket.updatedAt
    || ticket.createdAt;
  return Math.max(0, daysBetween(last));
}
