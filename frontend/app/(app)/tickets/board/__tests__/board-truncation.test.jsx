import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import BoardRoute from '../page.jsx';

const listTickets = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/tickets/board',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

vi.mock('@/shared/lib/use-history-search.js', () => ({
  useHistorySearch: () => window.location.search,
}));

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  AUTHENTICATED: 'authenticated',
  useAuth: () => ({ user: { id: 'u1', role: 'admin' }, status: 'authenticated' }),
}));

vi.mock('@/shared/contexts/project-context.jsx', () => ({
  useProject: () => ({ activeProjectId: 'proj-1', loading: false }),
}));

vi.mock('@/shared/contexts/ticket-preferences-context.jsx', () => ({
  useTicketPreferences: () => ({
    ready: true,
    preferences: { filters: { scope: 'all' }, sort: { column: 'ticketId', direction: 'desc' }, limit: 25 },
    boardMine: false,
    setBoardMine: vi.fn(),
  }),
}));

vi.mock('@/shared/hooks/use-board-policy.js', () => ({
  useBoardPolicy: () => ({ policy: {} }),
}));

vi.mock('@pms/shared', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    canInteractWithBoard: () => true,
    canDragTicket: () => true,
    canTransition: () => ({ allowed: true }),
    getBoardMoveBlockReason: () => null,
    getBoardDragBlockReason: () => null,
    getBoardMoveTargets: () => [],
    getBoardReadOnlyNotice: () => null,
    wouldFailOwnershipGuard: () => false,
    laneOf: actual.laneOf,
    LANES: actual.LANES,
  };
});

vi.mock('@/shared/hooks/use-permission-context.js', () => ({
  usePermissionContext: () => ({
    permissionContext: { loadFailed: false },
    loading: false,
    retryPermissions: vi.fn(),
  }),
}));

vi.mock('@/shared/api/tickets.js', () => ({
  listTickets: (...args) => listTickets(...args),
  transitionTicket: vi.fn(),
  getTicket: vi.fn(),
}));

vi.mock('@/shared/components/tickets/board-lane.jsx', () => ({
  default: () => <div data-testid="lane" />,
}));

vi.mock('@/shared/components/tickets/ticket-detail-drawer.jsx', () => ({
  default: () => null,
}));

describe('board truncation banner', () => {
  beforeEach(() => {
    listTickets.mockReset();
    window.history.replaceState(null, '', '/tickets/board');
  });

  it('shows a prominent banner when the board load hits the 1,000 cap', async () => {
    listTickets.mockImplementation(({ page }) => Promise.resolve({
      results: [{ ticketId: `WEB-${page}`, id: `id-${page}`, status: 'pending', title: 'T' }],
      totalResults: 2500,
      totalPages: 25,
      page,
      limit: 100,
    }));

    render(<BoardRoute />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/truncated/i);
      expect(screen.getByRole('link', { name: /filtered table/i })).toBeInTheDocument();
    });
  });
});
