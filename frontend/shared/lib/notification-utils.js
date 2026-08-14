/** Strip origin so Next.js Link can navigate in-app. */
export function notificationHref(link) {
  if (!link) return '/notifications';
  try {
    const url = new URL(link);
    return `${url.pathname}${url.search}`;
  } catch {
    return link.startsWith('/') ? link : '/notifications';
  }
}

export function formatRelativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const deltaSec = Math.round((Date.now() - then) / 1000);
  if (deltaSec < 60) return 'just now';

  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
