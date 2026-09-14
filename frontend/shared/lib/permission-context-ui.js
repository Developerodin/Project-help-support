/**
 * Permission context for client-side can()/canInScope() checks.
 * Deny-by-default only when the matrix explicitly failed to load (matches backend auth).
 */
export function permissionContextForUi(permissionContext) {
  if (!permissionContext) return null;
  if (permissionContext.loadFailed) return { loadFailed: true };
  return permissionContext;
}
