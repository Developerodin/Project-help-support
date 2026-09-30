'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import BrandMark from '@/shared/components/brand-mark.jsx';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { formatBrandDisplayName } from '@/shared/lib/branding.js';
import { loginHref, locationFromRoute } from '@/shared/lib/login-redirect.js';

export default function AuthRequiredScreen() {
  const { effectiveBranding, cookiesBlocked } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const href = loginHref(locationFromRoute(pathname, searchParams));

  return (
    <div className="auth-gate">
      <div className="auth-gate-card">
        <BrandMark className="auth-gate-mark" logoUrl={effectiveBranding?.logoUrl} name={effectiveBranding?.name} />
        <p className="auth-gate-brand">{formatBrandDisplayName(effectiveBranding?.name)}</p>
        {cookiesBlocked ? (
          <>
            <h1 className="auth-gate-title">Cookies are blocked</h1>
            <p className="auth-gate-copy">
              You signed in, but this browser didn’t keep the sign-in because it blocks cookies for this site.
              Allow cookies, then sign in again.
            </p>
            <p className="auth-gate-copy">
              In Safari: Settings → Privacy → turn off “Block all cookies”.
            </p>
          </>
        ) : (
          <>
            <h1 className="auth-gate-title">Sign in required</h1>
            <p className="auth-gate-copy">
              Your session isn't active. Sign in to continue to your workspace.
            </p>
          </>
        )}
        <Link className="button1" href={href}>{cookiesBlocked ? 'Sign in again' : 'Sign in'}</Link>
        <Link className="button3 auth-gate-back" href="/">Back to home</Link>
      </div>
    </div>
  );
}
