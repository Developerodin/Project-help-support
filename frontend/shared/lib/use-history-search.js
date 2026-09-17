'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Address-bar search string that stays in sync with pushState/replaceState and
 * the back/forward buttons (useSearchParams alone does not re-render on popstate).
 */
export function useHistorySearch() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(
    () => (typeof window !== 'undefined' ? window.location.search : ''),
  );

  const sync = useCallback(() => {
    const next = window.location.search;
    setSearch((prev) => (prev === next ? prev : next));
  }, []);

  useEffect(() => {
    sync();
  }, [searchParams, sync]);

  useEffect(() => {
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [sync]);

  return search;
}
