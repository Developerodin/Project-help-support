import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CompanyExternalAccessFields from '../company-external-access-fields.jsx';
import { ROLE_IDS } from '@pms/shared';

vi.mock('@/shared/api/users.js', () => ({
  listUsers: vi.fn(),
}));

import { listUsers } from '@/shared/api/users.js';

describe('CompanyExternalAccessFields', () => {
  beforeEach(() => {
    listUsers.mockImplementation((params) => {
      if (params.role === ROLE_IDS.CLIENT) {
        return Promise.resolve({
          results: [{ id: 'client-1', name: 'Client User', email: 'client@example.com' }],
        });
      }
      return Promise.resolve({
        results: [{ id: 'tester-1', name: 'Client Tester', email: 'tester@example.com' }],
      });
    });
  });

  it('renders external access sections with compact helper copy', async () => {
    render(
      <CompanyExternalAccessFields
        clientUserIds={[]}
        clientTesterIds={[]}
        onClientUserIdsChange={vi.fn()}
        onClientTesterIdsChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('External access')).toBeInTheDocument();
      expect(screen.getByText(/Manage which external users can access this company/i)).toBeInTheDocument();
      expect(screen.getByText('Company-wide access')).toBeInTheDocument();
      expect(screen.getByText('Client users')).toBeInTheDocument();
      expect(screen.getByText('Client testers')).toBeInTheDocument();
    });

    expect(screen.queryByText(/ticket visibility/i)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /client users/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /client testers/i })).toBeInTheDocument();
  });

  it('shows compact empty state when no users are available', async () => {
    listUsers.mockResolvedValue({ results: [] });

    render(
      <CompanyExternalAccessFields
        clientUserIds={[]}
        clientTesterIds={[]}
        onClientUserIdsChange={vi.fn()}
        onClientTesterIdsChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText('No client users available. Invite users from People.')).toHaveLength(1);
      expect(screen.getAllByText('No client testers available. Invite users from People.')).toHaveLength(1);
    });
  });

  it('renders selected users as chips with remove controls', async () => {
    const user = userEvent.setup();
    const onClientUserIdsChange = vi.fn();

    render(
      <CompanyExternalAccessFields
        clientUserIds={['client-1']}
        clientTesterIds={[]}
        onClientUserIdsChange={onClientUserIdsChange}
        onClientTesterIdsChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Client User')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /remove client user/i }));
    expect(onClientUserIdsChange).toHaveBeenCalledWith([]);
  });
});
