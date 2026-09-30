import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { AUTHENTICATED } from '../auth-context.jsx';
import {
  TicketPreferencesProvider,
  useTicketPreferences,
} from '../ticket-preferences-context.jsx';

const getTicketPreferences = vi.fn();
const updateTicketPreferences = vi.fn();
const resetTicketPreferences = vi.fn();
const refreshUser = vi.fn();

let authState = {
  status: AUTHENTICATED,
  user: { id: 'user-1', ticketPreferences: { filters: { q: 'from-user' } } },
  refreshUser,
};

vi.mock('../auth-context.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAuth: () => authState,
  };
});

vi.mock('../../api/users.js', () => ({
  getTicketPreferences: (...args) => getTicketPreferences(...args),
  updateTicketPreferences: (...args) => updateTicketPreferences(...args),
  resetTicketPreferences: (...args) => resetTicketPreferences(...args),
}));

function Probe() {
  const { ready, preferences } = useTicketPreferences();
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="q">{preferences.filters.q}</span>
    </div>
  );
}

describe('TicketPreferencesProvider hydration', () => {
  beforeEach(() => {
    getTicketPreferences.mockReset();
    refreshUser.mockReset();
    authState = {
      status: AUTHENTICATED,
      user: { id: 'user-1', ticketPreferences: { filters: { q: 'from-user' } } },
      refreshUser,
    };
  });

  it('becomes ready after preferences load even under StrictMode remount', async () => {
    let resolveFetch;
    getTicketPreferences.mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );

    render(
      <StrictMode>
        <TicketPreferencesProvider>
          <Probe />
        </TicketPreferencesProvider>
      </StrictMode>,
    );

    expect(screen.getByTestId('ready').textContent).toBe('false');

    resolveFetch({ filters: { q: 'from-api' } });

    await waitFor(() => {
      expect(screen.getByTestId('ready').textContent).toBe('true');
    });
    expect(screen.getByTestId('q').textContent).toBe('from-api');
  });

  it('falls back to user preferences when the API fails', async () => {
    getTicketPreferences.mockRejectedValueOnce(new Error('network'));

    render(
      <TicketPreferencesProvider>
        <Probe />
      </TicketPreferencesProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('ready').textContent).toBe('true');
    });
    expect(screen.getByTestId('q').textContent).toBe('from-user');
  });
});
