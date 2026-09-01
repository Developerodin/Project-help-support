'use client';

import { useEffect, useState } from 'react';

/**
 * Trails `value` by `delayMs`. The first value is returned immediately — a
 * mount is not a change, and delaying it would leave the first render empty.
 */
export function useDebouncedValue(value, delayMs) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (value === debounced) return undefined;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs, debounced]);

  return debounced;
}
