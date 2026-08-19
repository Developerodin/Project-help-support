/** @typedef {{ paths: string[], dots?: [number, number][] }} IconDef */

/** @type {Record<string, IconDef | string>} */
const ICONS = {
  board: {
    paths: [
      'M3.5 3.5h4v4.5h-4V3.5z',
      'M9 3.5h3.5v2.5H9V3.5z',
      'M3.5 9.5h4v3h-4v-3z',
      'M9 7.5h3.5v5H9v-5z',
    ],
  },
  ticket: {
    paths: ['M4.5 3.5h7a1 1 0 011 1v7a1 1 0 01-1 1h-7a1 1 0 01-1-1v-7a1 1 0 011-1z', 'M4.5 7h7'],
  },
  chart: {
    paths: ['M3 12.5h10', 'M5 10.5l2.5-2.5 2 1.5 3.5-4'],
  },
  bell: {
    paths: [
      'M8 2.5a3.5 3.5 0 00-3.5 3.5V9l-1 2h9l-1-2V6a3.5 3.5 0 00-3.5-3.5z',
      'M6.5 12.5a1.5 1.5 0 003 0',
    ],
  },
  layers: {
    paths: [
      'M2.5 5.5 5.5 4 8 5.5 5.5 7 2.5 5.5z',
      'M2.5 8.5 5.5 7 8 8.5 5.5 10 2.5 8.5z',
      'M2.5 11.5 5.5 10 8 11.5 5.5 13 2.5 11.5z',
    ],
  },
  teams: {
    paths: [
      'M5.5 6a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5z',
      'M10.5 6.75a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
      'M2.5 13c0-2 1.75-3 3-3s3 1 3 3',
      'M8.5 13c0-1.6 1.35-2.5 2.5-2.5s2.5.9 2.5 2.5',
    ],
  },
  user: {
    paths: ['M8 6a2.25 2.25 0 100-4.5A2.25 2.25 0 008 6z', 'M4 13.5c0-2.2 1.8-3.5 4-3.5s4 1.3 4 3.5'],
  },
  sliders: {
    paths: ['M2.5 5h11', 'M2.5 8h11', 'M2.5 11h11'],
    dots: [[5.5, 5], [10.5, 8], [6.5, 11]],
  },
  'chev-left': { paths: ['M10 4 6 8l4 4'] },
  'chev-right': { paths: ['M6 4l4 4-4 4'] },
  'sign-out': { paths: ['M6 12H3.5V4H6', 'M9.5 8H6', 'M12 8l-2.5-2.5', 'M12 8l-2.5 2.5'] },
  plus: { paths: ['M8 3.5v9', 'M3.5 8h9'] },
  x: { paths: ['M4.5 4.5l7 7', 'M11.5 4.5l-7 7'] },
  eye: {
    paths: ['M1.5 8S3.5 3.5 8 3.5 14.5 8 14.5 8 12.5 12.5 8 12.5 1.5 8 1.5 8z', 'M8 10.2A2.2 2.2 0 108 5.8a2.2 2.2 0 000 4.4z'],
  },
  clip: { paths: ['M10.5 3.5 6 8a2.5 2.5 0 103.5 3.5l4-4A1.5 1.5 0 0011 5.4L7 9.4'] },
  download: { paths: ['M8 2.5v7', 'M5.5 7 8 9.5 10.5 7', 'M3.5 12.5h9'] },
  trash: {
    paths: [
      'M3.5 4.5h9',
      'M5.5 4.5V3.5h5v1',
      'M6 4.5v7.5a1 1 0 001 1h2a1 1 0 001-1V4.5',
    ],
  },
  lock: {
    paths: [
      'M5.5 7.5V5.5a2.5 2.5 0 015 0V7.5',
      'M4.5 7.5h7a1 1 0 011 1v4a1 1 0 01-1 1h-7a1 1 0 01-1-1v-4a1 1 0 011-1z',
    ],
  },
  send: { paths: ['M14 2.5 3 9l4.5 1.5L8.5 14 14 2.5z', 'M8.5 14 8.5 9.5 14 2.5'] },
  msg: { paths: ['M3 4h10v7H7l-3 2V4z'] },
  alert: { paths: ['M8 2.5 14 13H2L8 2.5z', 'M8 6v3.5', 'M8 11.5h.01'] },
  back: { paths: ['M7 4 3 8l4 4', 'M3 8h10'] },
  more: { paths: ['M4 8h.01', 'M8 8h.01', 'M12 8h.01'] },
  list: 'ticket',
  proj: 'layers',
  team: 'teams',
};

function resolveIcon(name) {
  let current = ICONS[name];
  while (typeof current === 'string') current = ICONS[current];
  return current;
}

export default function Icon({ name, size = 16 }) {
  const icon = resolveIcon(name);
  if (!icon) return null;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icon.paths.map((d) => (
        <path key={d} d={d} />
      ))}
      {icon.dots?.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.15" fill="currentColor" stroke="none" />
      ))}
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
