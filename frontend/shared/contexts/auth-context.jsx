'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setAccessToken, setSessionLostHandler } from '../api/client.js';

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
  const router = useRouter();
  const loading = status === AUTH_BOOTING;

  useEffect(() => {
    setSessionLostHandler(() => {
      setAccessToken(null);
      setStatus((current) => (
        current === AUTHENTICATED || current === AUTH_EXPIRED
          ? AUTH_EXPIRED
          : AUTH_REQUIRED
      ));
    });
  }, []);

  useEffect(() => {
    // The access token is gone after a reload; the httpOnly refresh cookie is not.
    let cancelled = false;
    (async () => {
      try {
        const session = await apiFetch('/auth/refresh', { method: 'POST' });
        setAccessToken(session.accessToken);
        if (!cancelled) {
          setUser(session.user);
          setImpersonation(session.impersonation ?? null);
          setStatus(AUTHENTICATED);
        }
      } catch {
        // The access token now lives in memory only — a failed boot refresh
        // must not leave a stale one behind.
        setAccessToken(null);
        if (!cancelled) {
          setUser(null);
          setStatus(AUTH_REQUIRED);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email, password) => {
    const session = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus(AUTHENTICATED);
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setUser(null);
      setImpersonation(null);
      setStatus(AUTH_REQUIRED);
      router.replace('/login');
    }
  }, [router]);

  const startImpersonation = useCallback(async (userId) => {
    const session = await apiFetch(`/auth/impersonate/${userId}`, { method: 'POST' });
    setAccessToken(session.accessToken);
    setUser(session.user);
    setImpersonation(session.impersonation ?? null);
    return session.user;
  }, []);

  const stopImpersonation = useCallback(async () => {
    const session = await apiFetch('/auth/stop-impersonation', { method: 'POST' });
    setAccessToken(session.accessToken);
    setUser(session.user);
    setImpersonation(null);
    return session.user;
  }, []);

  const refreshUser = useCallback(async (knownUser) => {
    if (knownUser) {
      setUser(knownUser);
      return knownUser;
    }
    const session = await apiFetch('/auth/me');
    setUser(session.user);
    return session.user;
  }, []);

  const value = useMemo(
    () => ({
      user, loading, status, impersonation, login, logout, refreshUser,
      startImpersonation, stopImpersonation,
    }),
    [
      user, loading, status, impersonation, login, logout, refreshUser,
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
