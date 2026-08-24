'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import BrandMark from '@/shared/components/brand-mark.jsx';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { formatBrandDisplayName } from '@/shared/lib/branding.js';
import { loginHref, locationFromRoute } from '@/shared/lib/login-redirect.js';

export default function AuthRequiredScreen() {
  const { effectiveBranding } = useAuth();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const href = loginHref(locationFromRoute(pathname, searchParams));

  return (
    <div className="auth-gate">
      <div className="auth-gate-card">
        <BrandMark className="auth-gate-mark" logoUrl={effectiveBranding?.logoUrl} />
        <p className="auth-gate-brand">{formatBrandDisplayName(effectiveBranding?.name)}</p>
        <h1 className="auth-gate-title">Sign in required</h1>
        <p className="auth-gate-copy">
          Your session isn't active. Sign in to continue to your workspace.
        </p>
        <Link className="button1" href={href}>Sign in</Link>
        <Link className="button3 auth-gate-back" href="/">Back to home</Link>
      </div>
    </div>
  );
}
