import { API_URL } from '../lib/env.js';

export class ApiClientError extends Error {
  constructor({ status, code, message, fields, requestId }) {
    super(message || 'Request failed');
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.requestId = requestId;
  }
}

/**
 * The access token lives in memory only. localStorage would survive a tab close
 * and be readable by any script on the page; the refresh cookie is httpOnly and
 * is what actually carries the session across reloads.
 */
let accessToken = null;
let onSessionLost = null;

export const setAccessToken = (token) => { accessToken = token; };
export const getAccessToken = () => accessToken;
export const setSessionLostHandler = (fn) => { onSessionLost = fn; };

async function readError(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  return new ApiClientError({
    status: response.status,
    code: payload.error?.code ?? 'UNKNOWN',
    message: payload.error?.message ?? response.statusText,
    fields: payload.error?.fields,
    requestId: payload.requestId,
  });
}

async function rawFetch(path, { method = 'GET', body, formData, signal } = {}) {
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  // FormData sets its own multipart boundary; setting Content-Type breaks it.
  if (body !== undefined && !formData) headers['Content-Type'] = 'application/json';

  return fetch(`${API_URL}${path}`, {
    method,
    headers,
    // The refresh cookie is scoped to /v1/auth and httpOnly; it only travels
    // if credentials are included.
    credentials: 'include',
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    signal,
  });
}

async function refreshSession() {
  const response = await rawFetch('/auth/refresh', { method: 'POST' });
  if (!response.ok) return false;

  const data = await response.json();
  setAccessToken(data.accessToken);
  return true;
}

export async function apiFetch(path, options = {}) {
  let response = await rawFetch(path, options);

  // ONE refresh attempt, then give up. Retrying a failed refresh is how a
  // client ends up hammering the auth endpoint until the rate limiter answers.
  if (response.status === 401 && path !== '/auth/refresh' && path !== '/auth/login') {
    const refreshed = await refreshSession();
    if (!refreshed) {
      setAccessToken(null);
      onSessionLost?.();
      throw await readError(response);
    }
    response = await rawFetch(path, options);
  }

  if (!response.ok) throw await readError(response);
  if (response.status === 204) return null;
  return response.json();
}
