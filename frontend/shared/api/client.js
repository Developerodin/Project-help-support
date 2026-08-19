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

export const ACCESS_TOKEN_STORAGE_KEY = 'prowplus_accessToken';
/** Refresh token is stored in the httpOnly `prowplus_refreshToken` cookie (backend). */
export const REFRESH_TOKEN_STORAGE_KEY = 'prowplus_refreshToken';

function readStoredAccessToken() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredAccessToken(token) {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in private mode.
  }
}

let accessToken = readStoredAccessToken();
let onSessionLost = null;

export const setAccessToken = (token) => {
  accessToken = token;
  writeStoredAccessToken(token);
};
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
    message: payload.error?.message
    ?? (response.statusText?.trim() || `Request failed (${response.status})`),
    fields: payload.error?.fields,
    requestId: payload.requestId,
  });
}

async function rawFetch(path, { method = 'GET', body, formData, signal, redirect, headers: extraHeaders, ...rest } = {}) {
  const headers = { ...(extraHeaders || {}) };
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
    redirect,
    ...rest,
  });
}

async function refreshSession() {
  const response = await rawFetch('/auth/refresh', { method: 'POST' });
  if (!response.ok) return false;

  const data = await response.json();
  setAccessToken(data.accessToken);
  return true;
}

async function fetchWithAuthRetry(path, options = {}) {
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

  return response;
}

function isRedirectResponse(response) {
  return response.status === 301 || response.status === 302
    || response.status === 303 || response.status === 307 || response.status === 308;
}

/** Like apiFetch but returns the raw Response (for redirects, blobs, etc.). */
export async function apiFetchResponse(path, options = {}) {
  const response = await fetchWithAuthRetry(path, options);

  if (options.redirect === 'manual' && isRedirectResponse(response)) return response;
  if (!response.ok) throw await readError(response);
  return response;
}

export async function apiFetch(path, options = {}) {
  const response = await fetchWithAuthRetry(path, options);

  if (!response.ok) throw await readError(response);
  if (response.status === 204) return null;
  return response.json();
}
