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

/** Paths that must never trigger the 401 → refresh interceptor (loop prevention). */
const SKIP_REFRESH_PATHS = new Set(['/auth/refresh', '/auth/login', '/auth/logout']);

/** HTTP statuses that mean the server/network is unhealthy, not that the session is dead. */
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isTransientHttpStatus(status) {
  return TRANSIENT_HTTP_STATUSES.has(status);
}

/**
 * Temporary outage / transport failure. Never a reason to clear the session.
 * Network errors are normalized to status 0 + NETWORK_ERROR by rawFetch.
 */
export function isTransientApiError(error) {
  if (!error) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
  if (error instanceof TypeError) return true;
  if (error.code === 'NETWORK_ERROR' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return true;
  }
  if (error.status === 0) return true;
  return isTransientHttpStatus(error.status);
}

export function isSessionInvalidError(error) {
  if (!error) return false;
  if (error.status === 401) return true;
  return error.code === 'INVALID_REFRESH_TOKEN' || error.code === 'UNAUTHENTICATED';
}

/**
 * The access token lives in memory only (this module-level `let`) — never in
 * localStorage. It resets on every reload; `AuthProvider`'s boot effect
 * re-derives it from the httpOnly refresh cookie. An interim build persisted
 * it to localStorage under ACCESS_TOKEN_STORAGE_KEY; purge that key once on
 * module init so a stale token from that build is never read by anything
 * that still checks storage directly.
 */
function purgeStoredAccessToken() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in private mode.
  }
}
purgeStoredAccessToken();

let accessToken = null;
let onSessionLost = null;
let inFlightRefresh = null;
let sessionLostEmitted = false;

export const setAccessToken = (token) => {
  accessToken = token;
  if (token) sessionLostEmitted = false;
};
export const getAccessToken = () => accessToken;
export const setSessionLostHandler = (fn) => {
  onSessionLost = fn;
  sessionLostEmitted = false;
};

function emitSessionLost() {
  if (sessionLostEmitted) return;
  sessionLostEmitted = true;
  accessToken = null;
  onSessionLost?.();
}

/** A caller-initiated abort is not a failure — callers must be able to tell. */
export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORTED';
}

function wrapNetworkError(error) {
  if (error instanceof ApiClientError) return error;
  // Without this branch an abort arrives as an indistinguishable NETWORK_ERROR,
  // and every superseded request looks like the network died.
  if (error?.name === 'AbortError') {
    return new ApiClientError({
      status: 0,
      code: 'ABORTED',
      message: error.message || 'Request aborted',
    });
  }
  return new ApiClientError({
    status: 0,
    code: 'NETWORK_ERROR',
    message: error?.message || 'Network request failed',
  });
}

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

  try {
    return await fetch(`${API_URL}${path}`, {
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
  } catch (error) {
    throw wrapNetworkError(error);
  }
}

/**
 * Single-flight refresh. Returns the new session, or null when the refresh
 * token is actually invalid. Transient failures (5xx / network) throw and
 * MUST NOT be treated as logout.
 *
 * Uses rawFetch only — never fetchWithAuthRetry — so a 401 on refresh cannot
 * recurse into another refresh.
 */
async function refreshSession() {
  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      const response = await rawFetch('/auth/refresh', { method: 'POST' });
      if (response.ok) {
        const data = await response.json();
        setAccessToken(data.accessToken);
        return data;
      }
      const error = await readError(response);
      if (isTransientApiError(error)) throw error;
      if (error.status === 401 || isSessionInvalidError(error)) return null;
      throw error;
    })().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

function shouldAttemptRefresh(path, options) {
  if (options?.authRetry) return false;
  return !SKIP_REFRESH_PATHS.has(path);
}

async function fetchWithAuthRetry(path, options = {}) {
  const { authRetry: _authRetry, ...fetchOptions } = options;
  let response = await rawFetch(path, fetchOptions);

  // 403 is permission denied — never refresh.
  // 5xx / network never reach here as a 401.
  // ONE refresh + ONE retry. The replay uses rawFetch so it cannot loop.
  if (response.status === 401 && shouldAttemptRefresh(path, options)) {
    let refreshed;
    try {
      refreshed = await refreshSession();
    } catch (error) {
      // Backend restart, timeout, 502/503/504: keep the in-memory session.
      throw error;
    }
    if (!refreshed) {
      emitSessionLost();
      throw await readError(response);
    }
    response = await rawFetch(path, fetchOptions);
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
  if (path === '/auth/refresh') {
    const session = await refreshSession();
    if (!session) {
      throw new ApiClientError({
        status: 401,
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    }
    return session;
  }

  const response = await fetchWithAuthRetry(path, options);

  if (!response.ok) throw await readError(response);
  if (response.status === 204) return null;
  return response.json();
}
