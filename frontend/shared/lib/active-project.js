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
 * @param {Array<{ id: string, key: string }>} projects
 * @returns {string | null}
 */
export function resolveInitialProjectId(projects) {
  const stored = readStoredProjectId();
  if (stored && projects.some((p) => p.id === stored)) return stored;
  const web = projects.find((p) => p.key === 'WEB');
  return web?.id ?? projects[0]?.id ?? null;
}
