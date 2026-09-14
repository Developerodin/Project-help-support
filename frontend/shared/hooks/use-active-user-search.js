'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listUsers } from '@/shared/api/users.js';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';

/** Long enough to swallow a burst of typing, short enough to feel live. */
export const ACTIVE_USER_SEARCH_DEBOUNCE_MS = 300;
export const ACTIVE_USER_SEARCH_LIMIT = 50;

/**
 * Debounced server lookup for active users (name/email via `q`).
 * Used by team member pickers so people beyond the default first page are findable.
 */
export function useActiveUserSearch({ enabled = false, excludeIds = [] } = {}) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, ACTIVE_USER_SEARCH_DEBOUNCE_MS);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const excludeSet = useMemo(
    () => new Set(excludeIds.map((id) => String(id))),
    [excludeIds],
  );

  const fetchUsers = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    const q = debouncedQuery.trim();
    const params = { status: 'active', limit: ACTIVE_USER_SEARCH_LIMIT };
    if (q) params.q = q;

    return listUsers(params)
      .then((page) => {
        if (requestId !== requestIdRef.current) return;
        setResults(page.results || []);
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        setResults([]);
        setError(normalizeApiError(err)?.message || 'Could not search people');
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false);
      });
  }, [debouncedQuery]);

  useEffect(() => {
    if (!enabled) {
      setQuery('');
      setResults([]);
      setError(null);
      setLoading(false);
      requestIdRef.current += 1;
      return;
    }
    fetchUsers();
  }, [enabled, debouncedQuery, fetchUsers]);

  const available = useMemo(
    () => results.filter((u) => !excludeSet.has(String(u.id))),
    [results, excludeSet],
  );

  const retry = useCallback(() => {
    if (!enabled) return undefined;
    return fetchUsers();
  }, [enabled, fetchUsers]);

  return {
    query,
    setQuery,
    available,
    loading,
    error,
    retry,
  };
}
