'use client';

import { useEffect } from 'react';

/**
 * Registers the production service worker. Skipped in `next dev` so HMR and
 * the SW do not fight over cached modules. Installability is verified with
 * `npm run build && npm start` (or the monorepo prod start) over HTTPS /
 * localhost.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Installability degrades silently; auth and routing stay unaffected.
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
