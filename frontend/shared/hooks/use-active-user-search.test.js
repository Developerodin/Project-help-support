import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useActiveUserSearch,
  ACTIVE_USER_SEARCH_DEBOUNCE_MS,
  ACTIVE_USER_SEARCH_LIMIT,
} from './use-active-user-search.js';

vi.mock('@/shared/api/users.js', () => ({
  listUsers: vi.fn(),
}));

import { listUsers } from '@/shared/api/users.js';

describe('useActiveUserSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listUsers.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('searches with debounced q and excludes member ids', async () => {
    listUsers.mockResolvedValue({
      results: [
        { id: '1', name: 'Alice', email: 'a@x.com' },
        { id: '2', name: 'Vijay', email: 'v@x.com' },
        { id: '3', name: 'Bob', email: 'b@x.com' },
      ],
    });

    const { result } = renderHook(() => useActiveUserSearch({
      enabled: true,
      excludeIds: ['2'],
    }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    listUsers.mockClear();

    await act(async () => {
      result.current.setQuery('vij');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_USER_SEARCH_DEBOUNCE_MS);
      await vi.runAllTimersAsync();
    });

    expect(listUsers).toHaveBeenCalledWith({
      status: 'active',
      limit: ACTIVE_USER_SEARCH_LIMIT,
      q: 'vij',
    });
    expect(result.current.available.map((u) => u.name)).toEqual(['Alice', 'Bob']);
  });

  it('finds a user who would not appear on the default first page', async () => {
    listUsers.mockImplementation((params) => {
      if (params.q === 'vijay') {
        return Promise.resolve({
          results: [{ id: '99', name: 'Vijay Kumar', email: 'vijay@example.com' }],
        });
      }
      return Promise.resolve({
        results: Array.from({ length: 20 }, (_, i) => ({
          id: String(i + 1),
          name: `User ${i + 1}`,
          email: `u${i + 1}@x.com`,
        })),
      });
    });

    const { result } = renderHook(() => useActiveUserSearch({ enabled: true }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    await act(async () => {
      result.current.setQuery('vijay');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVE_USER_SEARCH_DEBOUNCE_MS);
      await vi.runAllTimersAsync();
    });

    expect(result.current.available.some((u) => u.name === 'Vijay Kumar')).toBe(true);
  });

  it('surfaces load errors', async () => {
    listUsers.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useActiveUserSearch({ enabled: true }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.available).toEqual([]);
  });
});
