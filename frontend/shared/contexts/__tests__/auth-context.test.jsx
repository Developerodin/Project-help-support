import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AuthProvider,
  useAuth,
  AUTH_BOOTING,
  AUTHENTICATED,
  AUTH_REQUIRED,
  AUTH_SIGNED_OUT,
  AUTH_EXPIRED,
} from '../auth-context.jsx';
import { ApiClientError } from '../../api/client.js';

const replace = vi.fn();
const apiFetch = vi.fn();
const setAccessToken = vi.fn();
const setSessionLostHandler = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: replace }),
}));

vi.mock('../../api/client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    apiFetch: (...args) => apiFetch(...args),
    setAccessToken: (...args) => setAccessToken(...args),
    setSessionLostHandler: (...args) => setSessionLostHandler(...args),
  };
});

function Probe() {
  const {
    status, cookiesBlocked, user, loading, impersonation, login, logout, startImpersonation, stopImpersonation,
  } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="cookies-blocked">{String(cookiesBlocked)}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.id ?? 'none'}</span>
      <span data-testid="impersonation">{impersonation?.by ?? 'none'}</span>
      <button type="button" onClick={() => login('a@b.com', 'secret')}>login</button>
      <button type="button" onClick={() => logout()}>logout</button>
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
    // Token now lives in memory only — a failed boot refresh must not leave a
    // stale in-memory access token behind.
    expect(setAccessToken).toHaveBeenCalledWith(null);
  });

  it('flags blocked cookies when the app refuses a sign-in made moments ago, and only then', async () => {
    const refused = () => new ApiClientError({ status: 401, code: 'INVALID_REFRESH_TOKEN' });
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2030, 0, 1));
    const bootInto = async () => {
      const view = render(<AuthProvider><Probe /></AuthProvider>);
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(AUTH_REQUIRED));
      return view;
    };
    try {
      // A cold visit: nobody signed in on this page, so it's a plain "sign in".
      apiFetch.mockRejectedValueOnce(refused());
      let view = await bootInto();
      expect(screen.getByTestId('cookies-blocked')).toHaveTextContent('false');

      // Signed in on the login page's provider...
      apiFetch.mockResolvedValueOnce({ accessToken: 'at', user: { id: 'u1' } });
      await userEvent.click(screen.getByRole('button', { name: 'login' }));
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(AUTHENTICATED));
      view.unmount();

      // ...then the app's provider finds no cookie a second later.
      now.mockReturnValue(Date.UTC(2030, 0, 1) + 1000);
      apiFetch.mockRejectedValueOnce(refused());
      view = await bootInto();
      expect(screen.getByTestId('cookies-blocked')).toHaveTextContent('true');
      view.unmount();

      // Long after that sign-in, a refused refresh is an ordinary expired session.
      now.mockReturnValue(Date.UTC(2030, 0, 1) + 5 * 60_000);
      apiFetch.mockRejectedValueOnce(refused());
      await bootInto();
      expect(screen.getByTestId('cookies-blocked')).toHaveTextContent('false');
    } finally {
      now.mockRestore();
    }
  });

  it('does not clear the access token when an in-flight boot refresh is cancelled', async () => {
    let rejectBoot;
    apiFetch.mockImplementation(() => new Promise((_, reject) => { rejectBoot = reject; }));
    const { unmount } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    unmount();
    await act(async () => { rejectBoot(new Error('no session')); });
    expect(setAccessToken).not.toHaveBeenCalledWith(null);
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

  it('I: a transient boot outage does not immediately log out', async () => {
    apiFetch.mockRejectedValue(Object.assign(new Error('unavailable'), {
      status: 503,
      code: 'UNAVAILABLE',
    }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.getByTestId('status')).toHaveTextContent(AUTH_BOOTING);
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(setAccessToken).not.toHaveBeenCalledWith(null);
    expect(replace).not.toHaveBeenCalled();
  });

  it('I: boot recovers after a temporary outage without going through login', async () => {
    apiFetch
      .mockRejectedValueOnce(Object.assign(new Error('unavailable'), {
        status: 503,
        code: 'UNAVAILABLE',
      }))
      .mockResolvedValueOnce({
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
    }, { timeout: 3000 });
    expect(screen.getByTestId('user')).toHaveTextContent('u1');
    expect(setAccessToken).toHaveBeenCalledWith('fresh');
    expect(setAccessToken).not.toHaveBeenCalledWith(null);
  });

  it('network failure on boot is not treated as an invalid session', async () => {
    apiFetch.mockRejectedValue(Object.assign(new Error('Failed to fetch'), {
      status: 0,
      code: 'NETWORK_ERROR',
    }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.getByTestId('status')).toHaveTextContent(AUTH_BOOTING);
    expect(setAccessToken).not.toHaveBeenCalledWith(null);
  });

  it('K: explicit logout clears the session immediately', async () => {
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

    apiFetch.mockResolvedValueOnce(null);
    await userEvent.click(screen.getByRole('button', { name: 'logout' }));

    expect(apiFetch).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
    expect(setAccessToken).toHaveBeenCalledWith(null);
    // Signed out, not "session isn't active": the guard shows a loader on the way to /login.
    expect(screen.getByTestId('status')).toHaveTextContent(AUTH_SIGNED_OUT);
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(replace).toHaveBeenCalledWith('/login');
  });
});
