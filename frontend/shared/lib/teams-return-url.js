export const TEAMS_RETURN_PARAM = 'return';

const DEFAULT_TEAMS_LIST = '/teams';

/**
 * Build the teams list URL from the current address-bar search string
 * (e.g. useHistorySearch() value).
 */
export function teamsListUrlFromSearch(searchString = '') {
  const raw = searchString.startsWith('?') ? searchString.slice(1) : searchString;
  if (!raw) return DEFAULT_TEAMS_LIST;
  return `${DEFAULT_TEAMS_LIST}?${raw}`;
}

/**
 * Resolve a safe in-app return URL for the teams list (open redirect guard).
 */
export function parseTeamsReturnUrl(value) {
  if (!value || typeof value !== 'string') return DEFAULT_TEAMS_LIST;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return DEFAULT_TEAMS_LIST;
  }
  if (!decoded.startsWith('/teams')) return DEFAULT_TEAMS_LIST;
  if (decoded.startsWith('//') || decoded.includes('://')) return DEFAULT_TEAMS_LIST;
  return decoded;
}

/** Append encoded teams list return path to a new/edit href. */
export function withTeamsReturn(href, listReturnUrl) {
  const safeReturn = parseTeamsReturnUrl(listReturnUrl);
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}${TEAMS_RETURN_PARAM}=${encodeURIComponent(safeReturn)}`;
}
