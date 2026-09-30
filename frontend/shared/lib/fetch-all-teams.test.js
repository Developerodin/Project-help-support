import { describe, expect, it, vi } from 'vitest';
import { fetchAllTeams } from './fetch-all-teams.js';

vi.mock('@/shared/api/teams.js', () => ({
  listTeams: vi.fn(),
}));

import { listTeams } from '@/shared/api/teams.js';

describe('fetchAllTeams', () => {
  it('loads all pages until totalResults are fetched', async () => {
    listTeams.mockImplementation(({ page }) => {
      if (page === 1) {
        return Promise.resolve({
          results: [{ id: '1' }, { id: '2' }],
          totalResults: 3,
          totalPages: 2,
        });
      }
      return Promise.resolve({
        results: [{ id: '3' }],
        totalResults: 3,
        totalPages: 2,
      });
    });

    const page = await fetchAllTeams({ status: 'active' });
    expect(page.results).toHaveLength(3);
    expect(page.totalResults).toBe(3);
    expect(page.resultsTruncated).toBe(false);
    expect(listTeams).toHaveBeenCalledTimes(2);
  });
});
