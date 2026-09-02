'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  DEFAULT_TICKET_PREFERENCES,
  mergeTicketPreferences,
  defaultTicketPreferencesForUser,
  normalizeTicketPreferencesForUser,
} from '@pms/shared';
import {
  getTicketPreferences,
  resetTicketPreferences,
  updateTicketPreferences,
} from '@/shared/api/users.js';
import { preferencesFromUser } from '@/shared/lib/ticket-list-query.js';
import { useAuth, AUTHENTICATED } from '@/shared/contexts/auth-context.jsx';

const TicketPreferencesContext = createContext(null);
const SAVE_DELAY_MS = 450;

export function TicketPreferencesProvider({ children }) {
  const { user, refreshUser, status } = useAuth();
  const [preferences, setPreferences] = useState(() => DEFAULT_TICKET_PREFERENCES);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef(null);
  const pendingSave = useRef(null);
  const hydrateRequestId = useRef(0);
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    if (status !== AUTHENTICATED || !user?.id) {
      setReady(false);
      return undefined;
    }

    const requestId = hydrateRequestId.current + 1;
    hydrateRequestId.current = requestId;
    const fromUser = preferencesFromUser(userRef.current);
    setPreferences(fromUser);
    setReady(false);

    getTicketPreferences()
      .then((stored) => {
        if (hydrateRequestId.current !== requestId) return;
        setPreferences(normalizeTicketPreferencesForUser(userRef.current, stored));
      })
      .catch(() => {
        if (hydrateRequestId.current !== requestId) return;
        setPreferences(fromUser);
      })
      .finally(() => {
        if (hydrateRequestId.current === requestId) setReady(true);
      });

    return undefined;
  }, [status, user?.id]);

  const flushSave = useCallback(async (nextPrefs) => {
    try {
      const updated = await updateTicketPreferences(nextPrefs);
      await refreshUser(updated);
    } catch {
      // Keep optimistic local state; the next edit will retry.
    }
  }, [refreshUser]);

  const scheduleSave = useCallback((nextPrefs) => {
    pendingSave.current = nextPrefs;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload = pendingSave.current;
      pendingSave.current = null;
      if (payload) flushSave(payload);
    }, SAVE_DELAY_MS);
  }, [flushSave]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const patchPreferences = useCallback((patch) => {
    setPreferences((current) => {
      const next = mergeTicketPreferences({
        ...current,
        ...patch,
        filters: { ...current.filters, ...(patch.filters || {}) },
        sort: { ...current.sort, ...(patch.sort || {}) },
      });
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const setFilters = useCallback((updater) => {
    setPreferences((current) => {
      const filters = typeof updater === 'function'
        ? updater(current.filters)
        : { ...current.filters, ...updater };
      const next = { ...current, filters };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const setSort = useCallback((sort) => {
    patchPreferences({ sort });
  }, [patchPreferences]);

  const setBoardMine = useCallback((boardMine) => {
    patchPreferences({ boardMine });
  }, [patchPreferences]);

  const reset = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingSave.current = null;
    try {
      const updated = await resetTicketPreferences();
      const next = preferencesFromUser(updated);
      setPreferences(next);
      await refreshUser(updated);
      return next;
    } catch (err) {
      const fallback = defaultTicketPreferencesForUser(userRef.current);
      setPreferences(fallback);
      throw err;
    }
  }, [refreshUser]);

  const value = useMemo(() => ({
    ready,
    preferences,
    filters: preferences.filters,
    sort: preferences.sort,
    boardMine: preferences.boardMine,
    limit: preferences.limit,
    setFilters,
    setSort,
    setBoardMine,
    patchPreferences,
    reset,
  }), [
    ready, preferences, setFilters, setSort, setBoardMine, patchPreferences, reset,
  ]);

  return (
    <TicketPreferencesContext.Provider value={value}>
      {children}
    </TicketPreferencesContext.Provider>
  );
}

export function useTicketPreferences() {
  const context = useContext(TicketPreferencesContext);
  if (!context) {
    throw new Error('useTicketPreferences must be used inside TicketPreferencesProvider');
  }
  return context;
}
