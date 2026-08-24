'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

const VALID_STATES = new Set(['data', 'loading', 'empty', 'error']);

export function usePreviewViewState() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const raw = searchParams.get('state') || 'data';
  const viewMode = VALID_STATES.has(raw) ? raw : 'data';

  const retry = useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete('state');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [pathname, router, searchParams]);

  return { viewMode, retry };
}
