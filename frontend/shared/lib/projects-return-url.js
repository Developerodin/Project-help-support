export const PROJECTS_RETURN_PARAM = 'return';

const DEFAULT_PROJECTS_LIST = '/projects';

/**
 * Build the projects list URL from the current address-bar search string
 * (e.g. useHistorySearch() value).
 */
export function projectsListUrlFromSearch(searchString = '') {
  const raw = searchString.startsWith('?') ? searchString.slice(1) : searchString;
  if (!raw) return DEFAULT_PROJECTS_LIST;
  return `${DEFAULT_PROJECTS_LIST}?${raw}`;
}

/**
 * Resolve a safe in-app return URL for the projects list (open redirect guard).
 */
export function parseProjectsReturnUrl(value) {
  if (!value || typeof value !== 'string') return DEFAULT_PROJECTS_LIST;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return DEFAULT_PROJECTS_LIST;
  }
  if (!decoded.startsWith('/projects')) return DEFAULT_PROJECTS_LIST;
  if (decoded.startsWith('//') || decoded.includes('://')) return DEFAULT_PROJECTS_LIST;
  return decoded;
}

/** Append encoded projects list return path to a new/edit href. */
export function withProjectsReturn(href, listReturnUrl) {
  const safeReturn = parseProjectsReturnUrl(listReturnUrl);
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}${PROJECTS_RETURN_PARAM}=${encodeURIComponent(safeReturn)}`;
}
