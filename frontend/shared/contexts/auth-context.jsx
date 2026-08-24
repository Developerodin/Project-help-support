'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setAccessToken, setSessionLostHandler } from '../api/client.js';
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
    let cancelled = false;
    (async () => {
      try {
        const session = await apiFetch('/auth/refresh', { method: 'POST' });
        setAccessToken(session.accessToken);
        if (!cancelled) {
          applySession(session);
          setStatus(AUTHENTICATED);
        }
      } catch {
        // A remount (React Strict Mode, Fast Refresh) cancels this probe.
        // Clearing the in-memory token here logs out a still-valid session
        // that the replacement effect is about to restore.
        if (cancelled) return;
        setAccessToken(null);
        setUser(null);
        setImpersonation(null);
        resetBrandingToNeutral();
        setStatus(AUTH_REQUIRED);
      }
    })();
    return () => { cancelled = true; };
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
      resetBrandingToNeutral();
      setStatus(AUTH_REQUIRED);
      router.replace('/login');
    }
  }, [resetBrandingToNeutral, router]);

  const startImpersonation = useCallback(async (userId) => {
    const session = await apiFetch(`/auth/impersonate/${userId}`, { method: 'POST' });
    setAccessToken(session.accessToken);
    applySession(session);
    return session.user;
  }, [applySession]);

  const stopImpersonation = useCallback(async () => {
    const session = await apiFetch('/auth/stop-impersonation', { method: 'POST' });
    if (session.accessToken) setAccessToken(session.accessToken);
    applySession(session);
    return session.user;
  }, [applySession]);

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
      startImpersonation, stopImpersonation,
    }),
    [
      user, loading, status, impersonation, effectiveBranding, login, logout, refreshUser,
      startImpersonation, stopImpersonation,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
