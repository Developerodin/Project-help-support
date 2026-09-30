import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  apiFetch, apiFetchResponse, setAccessToken, getAccessToken, setSessionLostHandler,
  ApiClientError, ACCESS_TOKEN_STORAGE_KEY,
  isTransientApiError, isSessionInvalidError,
} from '../client.js';

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

describe('apiFetch', () => {
  beforeEach(() => {
    setAccessToken(null);
    setSessionLostHandler(null);
    global.fetch = vi.fn();
  });

  it('prefixes the configured base URL and never a relative fallback', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await apiFetch('/tickets');

    expect(global.fetch.mock.calls[0][0]).toBe('http://localhost:4000/v1/tickets');
  });

  it('sends the access token as a bearer header', async () => {
    setAccessToken('token-abc');
    global.fetch.mockResolvedValueOnce(jsonResponse(200, {}));

    await apiFetch('/tickets');

    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token-abc');
  });

  it('unpacks the canonical error shape into a typed error', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(400, {
      error: {
        code: 'VALIDATION_ERROR', message: 'Validation failed', fields: { title: 'Required' },
      },
      requestId: 'req-1',
    }));

    await expect(apiFetch('/tickets', { method: 'POST', body: {} }))
      .rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
        fields: { title: 'Required' },
        requestId: 'req-1',
      });
  });

  it('refreshes once on a 401 and replays the original request', async () => {
    setAccessToken('expired');
    global.fetch
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'fresh', user: { id: 'u1' } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const result = await apiFetch('/tickets');

    expect(result).toEqual({ ok: true });
    expect(global.fetch.mock.calls[1][0]).toBe('http://localhost:4000/v1/auth/refresh');
    expect(global.fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer fresh');
  });

  it('does not loop when the refresh itself fails', async () => {
    setAccessToken('expired');
    global.fetch
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));

    await expect(apiFetch('/tickets')).rejects.toBeInstanceOf(ApiClientError);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent 401s into a single refresh', async () => {
    setAccessToken('expired');
    let releaseRefresh;
    const refreshHeld = new Promise((resolve) => { releaseRefresh = resolve; });

    global.fetch.mockImplementation((url) => {
      if (String(url).endsWith('/auth/refresh')) {
        return refreshHeld.then(() => jsonResponse(200, { accessToken: 'fresh', user: { id: 'u1' } }));
      }
      if (getAccessToken() === 'fresh') return Promise.resolve(jsonResponse(200, { ok: true }));
      return Promise.resolve(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
    });

    const first = apiFetch('/tickets');
    const second = apiFetch('/notifications');

    await vi.waitFor(() => {
      expect(global.fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/refresh')))
        .toHaveLength(1);
    });

    releaseRefresh();
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(global.fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/refresh')))
      .toHaveLength(1);
  });

  it('coalesces concurrent boot refresh probes into one POST', async () => {
    let releaseRefresh;
    const refreshHeld = new Promise((resolve) => { releaseRefresh = resolve; });
    global.fetch.mockImplementation((url) => {
      if (String(url).endsWith('/auth/refresh')) {
        return refreshHeld.then(() => jsonResponse(200, { accessToken: 'fresh', user: { id: 'u1' } }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    });

    const first = apiFetch('/auth/refresh', { method: 'POST' });
    const second = apiFetch('/auth/refresh', { method: 'POST' });
    await vi.waitFor(() => {
      expect(global.fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/refresh')))
        .toHaveLength(1);
    });
    releaseRefresh();
    await expect(first).resolves.toMatchObject({ accessToken: 'fresh' });
    await expect(second).resolves.toMatchObject({ accessToken: 'fresh' });
    expect(global.fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/refresh')))
      .toHaveLength(1);
  });

  it('sends credentials so the httpOnly refresh cookie travels', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(200, {}));

    await apiFetch('/auth/me');

    expect(global.fetch.mock.calls[0][1].credentials).toBe('include');
  });
});

describe('access token persistence', () => {
  it('does not export a REFRESH_TOKEN_STORAGE_KEY — the refresh token only ever lives in the httpOnly cookie', async () => {
    const mod = await import('../client.js');
    expect(mod.REFRESH_TOKEN_STORAGE_KEY).toBeUndefined();
  });

  it('keeps the access token in memory only — setAccessToken never touches localStorage', () => {
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    setAccessToken('mem-token');

    expect(getAccessToken()).toBe('mem-token');
    expect(window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBeNull();

    setAccessToken(null);
  });

  it('purges any access token left over from the interim build on module init', async () => {
    window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, 'stale-token-from-old-build');
    vi.resetModules();

    const fresh = await import('../client.js');

    expect(window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBeNull();
    expect(fresh.getAccessToken()).toBeNull();
  });
});

describe('apiFetchResponse', () => {
  beforeEach(() => {
    setAccessToken('token-abc');
    global.fetch = vi.fn();
  });

  it('returns a manual redirect without treating it as an error', async () => {
    global.fetch.mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { Location: 'https://s3.example/presigned' },
    }));

    const response = await apiFetchResponse('/tickets/T-1/attachments/a1/download', {
      redirect: 'manual',
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('https://s3.example/presigned');
  });
});

describe('error classification', () => {
  it('treats 5xx, 408, 429, and network errors as transient', () => {
    expect(isTransientApiError({ status: 500 })).toBe(true);
    expect(isTransientApiError({ status: 502 })).toBe(true);
    expect(isTransientApiError({ status: 503 })).toBe(true);
    expect(isTransientApiError({ status: 504 })).toBe(true);
    expect(isTransientApiError({ status: 408 })).toBe(true);
    expect(isTransientApiError({ status: 429 })).toBe(true);
    expect(isTransientApiError({ status: 0, code: 'NETWORK_ERROR' })).toBe(true);
    expect(isTransientApiError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('treats 401 as session-invalid and never as transient', () => {
    expect(isTransientApiError({ status: 401, code: 'UNAUTHENTICATED' })).toBe(false);
    expect(isSessionInvalidError({ status: 401, code: 'UNAUTHENTICATED' })).toBe(true);
    expect(isSessionInvalidError({ status: 403, code: 'FORBIDDEN' })).toBe(false);
  });
});

describe('session recovery vs outage', () => {
  let onLost;

  beforeEach(() => {
    onLost = vi.fn();
    setAccessToken('valid-token');
    setSessionLostHandler(onLost);
    global.fetch = vi.fn();
  });

  it('A: a valid session request succeeds without refresh', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await expect(apiFetch('/tickets')).resolves.toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(global.fetch.mock.calls[0][0])).not.toMatch(/refresh/);
    expect(onLost).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('valid-token');
  });

  it('B: expired access + valid refresh retries once and stays logged in', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'fresh', user: { id: 'u1' } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await expect(apiFetch('/tickets')).resolves.toEqual({ ok: true });
    expect(getAccessToken()).toBe('fresh');
    expect(onLost).not.toHaveBeenCalled();
    expect(global.fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/refresh')))
      .toHaveLength(1);
  });

  it('C: concurrent 401s share exactly one refresh', async () => {
    let releaseRefresh;
    const refreshHeld = new Promise((resolve) => { releaseRefresh = resolve; });
    global.fetch.mockImplementation((url) => {
      if (String(url).endsWith('/auth/refresh')) {
        return refreshHeld.then(() => jsonResponse(200, { accessToken: 'fresh', user: { id: 'u1' } }));
      }
      if (getAccessToken() === 'fresh') return Promise.resolve(jsonResponse(200, { ok: true }));
      return Promise.resolve(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
    });

    const first = apiFetch('/tickets');
    const second = apiFetch('/notifications');
    await vi.waitFor(() => {
      expect(global.fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/refresh')))
        .toHaveLength(1);
    });
    releaseRefresh();
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(global.fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/refresh')))
      .toHaveLength(1);
    expect(onLost).not.toHaveBeenCalled();
  });

  it('D: expired refresh clears the session once and does not recurse', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } }));

    await expect(apiFetch('/tickets')).rejects.toMatchObject({ status: 401 });
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('D: concurrent 401s with a dead refresh emit session-lost once', async () => {
    global.fetch.mockImplementation((url) => {
      if (String(url).endsWith('/auth/refresh')) {
        return Promise.resolve(jsonResponse(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } }));
      }
      return Promise.resolve(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));
    });

    await Promise.all([
      apiFetch('/tickets').catch((err) => err),
      apiFetch('/notifications').catch((err) => err),
    ]);

    expect(onLost).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBeNull();
    expect(global.fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/refresh')))
      .toHaveLength(1);
  });

  it('E: 500 remains authenticated and does not refresh', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(500, { error: { code: 'INTERNAL', message: 'x' } }));

    await expect(apiFetch('/tickets')).rejects.toMatchObject({ status: 500 });
    expect(onLost).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('valid-token');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('F: 503 remains authenticated and does not refresh', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(503, { error: { code: 'UNAVAILABLE', message: 'x' } }));

    await expect(apiFetch('/tickets')).rejects.toMatchObject({ status: 503 });
    expect(onLost).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('valid-token');
  });

  it('G: network failure remains authenticated', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(apiFetch('/tickets')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
    expect(onLost).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('valid-token');
  });

  it('H: 401 then refresh 503 (backend restart) does not log out', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockResolvedValueOnce(jsonResponse(503, { error: { code: 'UNAVAILABLE', message: 'restarting' } }));

    await expect(apiFetch('/tickets')).rejects.toMatchObject({ status: 503 });
    expect(onLost).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('valid-token');
  });

  it('does not refresh or log out on 403', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'nope' } }));

    await expect(apiFetch('/tickets')).rejects.toMatchObject({ status: 403 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(onLost).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('valid-token');
  });

  it('J: a retried request is only retried once after a successful refresh', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'fresh', user: { id: 'u1' } }))
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'UNAUTHENTICATED', message: 'x' } }));

    await expect(apiFetch('/tickets')).rejects.toMatchObject({ status: 401 });
    expect(global.fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/refresh')))
      .toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(onLost).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('fresh');
  });

  it('J: refresh itself never triggers the refresh interceptor', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(401, { error: { code: 'INVALID_REFRESH_TOKEN', message: 'x' } }));

    await expect(apiFetch('/auth/refresh', { method: 'POST' })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_REFRESH_TOKEN',
    });
    // Signed out (no cookie): one refresh, no retry, no interceptor on top.
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(onLost).not.toHaveBeenCalled();
  });

  it('boot refresh 503 is a transient error, not an invalid session', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(503, { error: { code: 'UNAVAILABLE', message: 'x' } }));

    await expect(apiFetch('/auth/refresh', { method: 'POST' })).rejects.toMatchObject({ status: 503 });
    expect(onLost).not.toHaveBeenCalled();
    expect(getAccessToken()).toBe('valid-token');
  });

  it('K: logout path does not attempt refresh', async () => {
    global.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String(global.fetch.mock.calls[0][0])).toMatch(/\/auth\/logout$/);
    expect(onLost).not.toHaveBeenCalled();
  });
});

describe('refresh after another tab rotated the cookie', () => {
  it('retries once and keeps the session', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: 'REFRESH_TOKEN_ROTATED', message: 'x' } }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'fresh', user: { id: 'u1' } }));

    await expect(apiFetch('/auth/refresh', { method: 'POST' })).resolves.toMatchObject({ accessToken: 'fresh' });
    expect(getAccessToken()).toBe('fresh');
  });
});
