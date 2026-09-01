'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, isTransientApiError, setAccessToken, setSessionLostHandler } from '../api/client.js';
import {
  applyDocumentBranding,
  neutralBranding,
  resolveEffectiveBranding,
} from '../lib/branding.js';

export const AUTH_BOOTING = 'AUTH_BOOTING';
export const AUTHENTICATED = 'AUTHENTICATED';
export const AUTH_REQUIRED = 'AUTH_REQUIRED';
export const AUTH_EXPIRED = 'AUTH_EXPIRED';

const AuthContext = createContext(null);

const nameOf = (person) => person?.name || person?.email || null;

/** Backoff between boot refresh attempts while the backend is unreachable. Last value repeats. */
const BOOT_RETRY_DELAYS_MS = [400, 1000, 2500, 5000];

/**
 * Carries `user.role` and nothing else. No permissions array, no route
 * permission map. Role is used ONLY to hide or disable navigation — server
 * enforcement is what actually protects every route.
 *
 * `status` is the session lifecycle. `user === null` is not enough: a cold
 * visit and a session that died mid-work are different products.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(AUTH_BOOTING);
  const [impersonation, setImpersonation] = useState(null);
  // What the app is in the middle of doing to the session, so a guard that
  // blocks on the way through can say "Impersonating Dev Chhugani…" instead of
  // a bare "Redirecting…". Cleared by whoever stops blocking on it.
  const [sessionNotice, setSessionNotice] = useState(null);
  const [effectiveBranding, setEffectiveBranding] = useState(() => neutralBranding());
  const router = useRouter();
  const loading = status === AUTH_BOOTING;

  const setBranding = useCallback((rawBranding) => {
    const next = resolveEffectiveBranding(rawBranding);
    applyDocumentBranding(next);
    setEffectiveBranding(next);
    return next;
  }, []);

  const resetBrandingToNeutral = useCallback(() => {
    setBranding(neutralBranding());
  }, [setBranding]);

  const applySession = useCallback((session) => {
    setUser(session?.user ?? null);
    setImpersonation(session?.impersonation ?? null);
    setBranding(session?.effectiveBranding);
  }, [setBranding]);

  useEffect(() => {
    setSessionLostHandler(() => {
      setAccessToken(null);
      setImpersonation(null);
      resetBrandingToNeutral();
      setStatus((current) => (
        current === AUTHENTICATED || current === AUTH_EXPIRED
          ? AUTH_EXPIRED
          : AUTH_REQUIRED
      ));
    });
  }, [resetBrandingToNeutral]);

  useEffect(() => {
    // The access token is gone after a reload; the httpOnly refresh cookie is not.
    // Transient boot failures (backend restart, 502/503, network) must retry
    // rather than AUTH_REQUIRED — that would send a still-valid session to login.
    // Invalid refresh (401) stops immediately so we never spin on a dead session.
    let cancelled = false;
    let retryTimer;
    const wait = (ms) => new Promise((resolve) => {
      retryTimer = setTimeout(resolve, ms);
    });

    (async () => {
      for (let attempt = 0; !cancelled; attempt += 1) {
        if (attempt > 0) {
          const delay = BOOT_RETRY_DELAYS_MS[Math.min(attempt - 1, BOOT_RETRY_DELAYS_MS.length - 1)];
          await wait(delay);
          if (cancelled) return;
        }
        try {
          const session = await apiFetch('/auth/refresh', { method: 'POST' });
          if (cancelled) return;
          setAccessToken(session.accessToken);
          applySession(session);
          setStatus(AUTHENTICATED);
          return;
        } catch (error) {
          if (cancelled) return;
          if (isTransientApiError(error)) continue;
          setAccessToken(null);
          setUser(null);
          setImpersonation(null);
          resetBrandingToNeutral();
          setStatus(AUTH_REQUIRED);
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [applySession, resetBrandingToNeutral]);

  const login = useCallback(async (email, password) => {
    const session = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
    setAccessToken(session.accessToken);
    applySession(session);
    setStatus(AUTHENTICATED);
    return session.user;
  }, [applySession]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setUser(null);
      setImpersonation(null);
      setSessionNotice(null);
      resetBrandingToNeutral();
      setStatus(AUTH_REQUIRED);
      router.replace('/login');
    }
  }, [resetBrandingToNeutral, router]);

  const clearSessionNotice = useCallback(() => setSessionNotice(null), []);

  const startImpersonation = useCallback(async (userId, displayName) => {
    setSessionNotice(displayName ? `Impersonating ${displayName}…` : 'Starting impersonation…');
    try {
      const session = await apiFetch(`/auth/impersonate/${userId}`, { method: 'POST' });
      setAccessToken(session.accessToken);
      applySession(session);
      setSessionNotice(`Impersonating ${nameOf(session.user) || displayName || 'user'}…`);
      return session.user;
    } catch (error) {
      setSessionNotice(null);
      throw error;
    }
  }, [applySession]);

  const stopImpersonation = useCallback(async () => {
    const leaving = nameOf(user);
    setSessionNotice(leaving ? `Exiting impersonation of ${leaving}…` : 'Exiting impersonation…');
    try {
      const session = await apiFetch('/auth/stop-impersonation', { method: 'POST' });
      if (session.accessToken) setAccessToken(session.accessToken);
      applySession(session);
      return session.user;
    } catch (error) {
      setSessionNotice(null);
      throw error;
    }
  }, [applySession, user]);

  const refreshUser = useCallback(async (knownUser) => {
    if (knownUser) {
      setUser(knownUser);
      return knownUser;
    }
    const session = await apiFetch('/auth/me');
    applySession(session);
    return session.user;
  }, [applySession]);

  const value = useMemo(
    () => ({
      user, loading, status, impersonation, effectiveBranding, login, logout, refreshUser,
      startImpersonation, stopImpersonation, sessionNotice, clearSessionNotice,
    }),
    [
      user, loading, status, impersonation, effectiveBranding, login, logout, refreshUser,
      startImpersonation, stopImpersonation, sessionNotice, clearSessionNotice,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
