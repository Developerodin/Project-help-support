'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setAccessToken, setSessionLostHandler } from '../api/client.js';

const AuthContext = createContext(null);

/**
 * Carries `user.role` and nothing else. No permissions array, no route
 * permission map. Role is used ONLY to hide or disable navigation — server
 * enforcement is what actually protects every route.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    setSessionLostHandler(() => {
      setUser(null);
      router.replace('/login');
    });
  }, [router]);

  useEffect(() => {
    // The access token is gone after a reload; the httpOnly refresh cookie is not.
    let cancelled = false;
    (async () => {
      try {
        const session = await apiFetch('/auth/refresh', { method: 'POST' });
        setAccessToken(session.accessToken);
        if (!cancelled) setUser(session.user);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email, password) => {
    const session = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
    setAccessToken(session.accessToken);
    setUser(session.user);
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } finally {
      setAccessToken(null);
      setUser(null);
      router.replace('/login');
    }
  }, [router]);

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
    () => ({ user, loading, login, logout, refreshUser }),
    [user, loading, login, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
