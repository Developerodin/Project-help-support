import { describe, expect, it, vi } from 'vitest';
import { commitAccessMutation } from '../people-access-mutations.js';

describe('commitAccessMutation', () => {
  it('treats grant success as success when refresh fails', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn().mockRejectedValue(new Error('refresh failed'));
    const onRefreshFailure = vi.fn();

    await commitAccessMutation({ commit, refresh, onRefreshFailure });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onRefreshFailure).toHaveBeenCalledTimes(1);
  });

  it('treats revoke success as success when refresh fails', async () => {
    const commit = vi.fn().mockResolvedValue({ id: 'asg-1', status: 'revoked' });
    const refresh = vi.fn().mockRejectedValue(new Error('network error'));
    const onRefreshFailure = vi.fn();

    const result = await commitAccessMutation({ commit, refresh, onRefreshFailure });

    expect(result).toBeUndefined();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(onRefreshFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'network error' }));
  });

  it('propagates commit failures without calling refresh', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('mutation failed'));
    const refresh = vi.fn();

    await expect(commitAccessMutation({ commit, refresh })).rejects.toThrow('mutation failed');
    expect(refresh).not.toHaveBeenCalled();
  });
});
