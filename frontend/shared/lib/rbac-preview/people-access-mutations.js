/**
 * Run a committed mutation then refresh UI state. Mutation success is reported even when
 * refresh fails so clients do not retry already-committed operations.
 */
export async function commitAccessMutation({ commit, refresh, onRefreshFailure }) {
  await commit();
  try {
    await refresh();
  } catch (refreshErr) {
    onRefreshFailure?.(refreshErr);
  }
}
