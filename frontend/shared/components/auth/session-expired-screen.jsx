'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import BrandMark from '@/shared/components/brand-mark.jsx';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { formatBrandDisplayName } from '@/shared/lib/branding.js';
import { loginHref, locationFromRoute } from '@/shared/lib/login-redirect.js';

export default function SessionExpiredScreen() {
  const { effectiveBranding } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const href = loginHref(locationFromRoute(pathname, searchParams));
  const actionRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => actionRef.current?.focus(), 50);
    const onKey = (event) => {
      if (event.key === 'Escape') event.preventDefault();
      if (event.key === 'Tab') {
        event.preventDefault();
        actionRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.body.style.overflow = '';
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
    };
  }, []);

  return (
    <div className="auth-expired-scrim" role="presentation">
      <div
        className="auth-expired-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="auth-expired-title"
        aria-describedby="auth-expired-copy"
      >
        <BrandMark className="auth-gate-mark" logoUrl={effectiveBranding?.logoUrl} />
        <p className="auth-gate-brand">{formatBrandDisplayName(effectiveBranding?.name)}</p>
        <h2 id="auth-expired-title" className="auth-gate-title">Session expired</h2>
        <p id="auth-expired-copy" className="auth-gate-copy">
          Your session has expired. Please sign in again to continue.
        </p>
        <Link ref={actionRef} className="button1" href={href}>Sign in again</Link>
      </div>
    </div>
  );
}
