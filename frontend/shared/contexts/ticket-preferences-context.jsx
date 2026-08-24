'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  DEFAULT_TICKET_PREFERENCES,
  mergeTicketPreferences,
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
  const [page, setPage] = useState(1);
  const saveTimer = useRef(null);
  const pendingSave = useRef(null);
  const hydratedUserId = useRef(null);

  useEffect(() => {
    if (status !== AUTHENTICATED || !user?.id) {
      setReady(false);
      hydratedUserId.current = null;
      return undefined;
    }

    if (hydratedUserId.current === user.id) return undefined;
    hydratedUserId.current = user.id;

    let cancelled = false;
    const fromUser = preferencesFromUser(user);
    setPreferences(fromUser);
    setPage(1);
    setReady(false);

    getTicketPreferences()
      .then((stored) => {
        if (cancelled) return;
        setPreferences(mergeTicketPreferences(stored));
        setPage(1);
      })
      .catch(() => {
        if (!cancelled) setPreferences(fromUser);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => { cancelled = true; };
  }, [status, user]);

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
    setPage(1);
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
    setPage(1);
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
      setPage(1);
      await refreshUser(updated);
      return next;
    } catch (err) {
      const fallback = mergeTicketPreferences(DEFAULT_TICKET_PREFERENCES);
      setPreferences(fallback);
      setPage(1);
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
    page,
    setPage,
    setFilters,
    setSort,
    setBoardMine,
    patchPreferences,
    reset,
  }), [
    ready, preferences, page, setFilters, setSort, setBoardMine, patchPreferences, reset,
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
