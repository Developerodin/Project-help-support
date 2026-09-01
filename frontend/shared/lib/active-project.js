export const ACTIVE_PROJECT_STORAGE_KEY = 'pms:activeProjectId';

/** @returns {string | null} project id, or null for all projects */
export function readStoredProjectId() {
  if (typeof window === 'undefined') return null;
  const stored = window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
  if (!stored || stored === 'all') return null;
  return stored;
}

/** @param {string | null} projectId */
export function writeStoredProjectId(projectId) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, projectId || 'all');
}

/**
 * Pick the initial project from stored preference, defaulting to WEB when unset.
 * External users with multiple projects keep stored preference; single-project users
 * are handled by the provider before this runs.
 * @param {Array<{ id: string, key: string }>} projects
 * @param {{ isExternal?: boolean }} options
 * @returns {string | null}
 */
export function resolveInitialProjectId(projects, { isExternal = false } = {}) {
  const stored = readStoredProjectId();
  if (stored && projects.some((p) => p.id === stored)) return stored;
  if (isExternal) {
    if (projects.length === 1) return projects[0].id;
    return projects[0]?.id ?? null;
  }
  const web = projects.find((p) => p.key === 'WEB');
  return web?.id ?? projects[0]?.id ?? null;
}
