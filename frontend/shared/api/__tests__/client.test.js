import { describe, it, expect, beforeEach, vi } from 'vitest';
import { apiFetch, setAccessToken, ApiClientError } from '../client.js';

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

describe('apiFetch', () => {
  beforeEach(() => {
    setAccessToken(null);
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

  it('sends credentials so the httpOnly refresh cookie travels', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse(200, {}));

    await apiFetch('/auth/me');

    expect(global.fetch.mock.calls[0][1].credentials).toBe('include');
  });
});
