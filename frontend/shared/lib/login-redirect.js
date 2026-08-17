const DEFAULT_AFTER_LOGIN = '/tickets';

const AUTH_PREFIXES = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/invite',
];

export function sanitizeRedirect(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('\\')) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return null;

  const pathname = raw.split(/[?#]/, 1)[0];
  if (AUTH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return null;
  }

  return raw;
}

export function locationFromRoute(pathname, searchParams) {
  const path = pathname || '/';
  const query = typeof searchParams?.toString === 'function' ? searchParams.toString() : '';
  return query ? `${path}?${query}` : path;
}

export function loginHref(from) {
  const safe = sanitizeRedirect(from);
  if (!safe) return '/login';
  return `/login?redirect=${encodeURIComponent(safe)}`;
}

export function resolveLoginRedirect(raw) {
  return sanitizeRedirect(raw) || DEFAULT_AFTER_LOGIN;
}
