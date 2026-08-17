import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AuthProvider,
  useAuth,
  AUTH_BOOTING,
  AUTHENTICATED,
  AUTH_REQUIRED,
  AUTH_EXPIRED,
} from '../auth-context.jsx';

const replace = vi.fn();
const apiFetch = vi.fn();
const setAccessToken = vi.fn();
const setSessionLostHandler = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: replace }),
}));

vi.mock('../../api/client.js', () => ({
  apiFetch: (...args) => apiFetch(...args),
  setAccessToken: (...args) => setAccessToken(...args),
  setSessionLostHandler: (...args) => setSessionLostHandler(...args),
}));

function Probe() {
  const {
    status, user, loading, impersonation, startImpersonation, stopImpersonation,
  } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.id ?? 'none'}</span>
      <span data-testid="impersonation">{impersonation?.by ?? 'none'}</span>
      <button type="button" onClick={() => startImpersonation('target-1')}>start</button>
      <button type="button" onClick={() => stopImpersonation()}>stop</button>
    </div>
  );
}

describe('AuthProvider status', () => {
  beforeEach(() => {
    replace.mockReset();
    apiFetch.mockReset();
    setAccessToken.mockReset();
    setSessionLostHandler.mockReset();
  });

  it('starts in AUTH_BOOTING and does not treat a failed boot as expiry', async () => {
    apiFetch.mockRejectedValueOnce(new Error('no session'));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(screen.getByTestId('status')).toHaveTextContent(AUTH_BOOTING);
    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent(AUTH_REQUIRED);
    });
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(replace).not.toHaveBeenCalled();
  });

  it('becomes AUTHENTICATED when refresh restores a session', async () => {
    apiFetch.mockResolvedValueOnce({
      accessToken: 'fresh',
      user: { id: 'u1', role: 'member' },
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent(AUTHENTICATED);
    });
    expect(screen.getByTestId('user')).toHaveTextContent('u1');
    expect(setAccessToken).toHaveBeenCalledWith('fresh');
  });

  it('marks AUTH_EXPIRED on session loss without navigating away', async () => {
    apiFetch.mockResolvedValueOnce({
      accessToken: 'fresh',
      user: { id: 'u1', role: 'member' },
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent(AUTHENTICATED);
    });

    const onLost = setSessionLostHandler.mock.calls.at(-1)?.[0];
    expect(typeof onLost).toBe('function');

    act(() => { onLost(); });

    expect(screen.getByTestId('status')).toHaveTextContent(AUTH_EXPIRED);
    expect(screen.getByTestId('user')).toHaveTextContent('u1');
    expect(setAccessToken).toHaveBeenCalledWith(null);
    expect(replace).not.toHaveBeenCalled();
  });

  it('startImpersonation swaps to the target session and records who started it', async () => {
    apiFetch.mockRejectedValueOnce(new Error('no session'));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(AUTH_REQUIRED));

    apiFetch.mockResolvedValueOnce({
      accessToken: 'impersonated-token',
      user: { id: 'target-1', role: 'member' },
      impersonation: { by: 'admin-1', byName: 'Admin' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'start' }));

    expect(apiFetch).toHaveBeenCalledWith('/auth/impersonate/target-1', { method: 'POST' });
    expect(setAccessToken).toHaveBeenCalledWith('impersonated-token');
    expect(screen.getByTestId('user')).toHaveTextContent('target-1');
    expect(screen.getByTestId('impersonation')).toHaveTextContent('admin-1');
  });

  it('stopImpersonation restores the admin session and clears impersonation', async () => {
    apiFetch.mockRejectedValueOnce(new Error('no session'));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(AUTH_REQUIRED));

    apiFetch.mockResolvedValueOnce({
      accessToken: 'impersonated-token',
      user: { id: 'target-1', role: 'member' },
      impersonation: { by: 'admin-1', byName: 'Admin' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'start' }));
    expect(screen.getByTestId('impersonation')).toHaveTextContent('admin-1');

    apiFetch.mockResolvedValueOnce({
      accessToken: 'admin-token',
      user: { id: 'admin-1', role: 'admin' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'stop' }));

    expect(apiFetch).toHaveBeenCalledWith('/auth/stop-impersonation', { method: 'POST' });
    expect(setAccessToken).toHaveBeenCalledWith('admin-token');
    expect(screen.getByTestId('user')).toHaveTextContent('admin-1');
    expect(screen.getByTestId('impersonation')).toHaveTextContent('none');
  });
});
