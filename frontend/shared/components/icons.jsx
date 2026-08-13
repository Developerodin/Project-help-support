const PATHS = {
  board: 'M3 3h6v8H3V3zm8 0h6v4h-6V3zM3 13h6v8H3v-8zm8-4h6v12h-6V9z',
  list: 'M4 6h12M4 10h12M4 14h8',
  chart: 'M4 14l3-3 3 2 5-6',
  proj: 'M3 7h10v10H3V7zm2 2v6h6V9H5z',
  team: 'M8 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3 14c0-2 2.2-3.5 5-3.5S13 12 13 14',
  user: 'M8 8a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM3.5 14c0-2.2 2-3.5 4.5-3.5s4.5 1.3 4.5 3.5',
  bell: 'M8 2a4 4 0 00-4 4v3l-1 2h10l-1-2V6a4 4 0 00-4-4zm0 12a1.5 1.5 0 01-1.4-1h2.8A1.5 1.5 0 018 14z',
  plus: 'M8 3v10M3 8h10',
  x: 'M4 4l8 8M12 4l-8 8',
  eye: 'M1.5 8S3.5 3.5 8 3.5 14.5 8 14.5 8 12.5 12.5 8 12.5 1.5 8 1.5 8zM8 10.2A2.2 2.2 0 108 5.8a2.2 2.2 0 000 4.4z',
  clip: 'M10 3.5L5.5 8A2.5 2.5 0 109 11.5l4-4A1.5 1.5 0 0011 5.4L7 9.4',
  msg: 'M3 4h10v7H7l-3 2V4z',
  alert: 'M8 2.5L14 13H2L8 2.5zM8 6v3.5M8 11.5h.01',
  back: 'M7 4L3 8l4 4M3 8h10',
  more: 'M4 8h.01M8 8h.01M12 8h.01',
};

export default function Icon({ name, size = 14 }) {
  const d = PATHS[name];
  if (!d) return null;
  const stroke = !['board', 'proj'].includes(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={stroke ? 'none' : 'currentColor'}
      stroke={stroke ? 'currentColor' : 'none'}
      strokeWidth={stroke ? 1.5 : undefined}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?';
}

export function priorityChipClass(priority) {
  if (priority === 'Urgent') return 'chip chip-p1';
  if (priority === 'high') return 'chip chip-p2';
  return 'chip chip-p3';
}

export function priorityLabel(priority) {
  if (priority === 'Urgent') return 'P1';
  if (priority === 'high') return 'P2';
  if (priority === 'medium') return 'P3';
  if (priority === 'low') return 'P4';
  return priority || '—';
}

export function isOverdue(ticket) {
  if (!ticket?.estimatedResolutionAt) return false;
  if (ticket.status === 'closed' || ticket.status === 'live') return false;
  return new Date(ticket.estimatedResolutionAt).getTime() < Date.now();
}
