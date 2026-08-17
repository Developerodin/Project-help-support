'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import BrandMark from '@/shared/components/brand-mark.jsx';
import { BRAND_SHORT } from '@/shared/lib/brand.js';
import { loginHref, locationFromRoute } from '@/shared/lib/login-redirect.js';

export default function AuthRequiredScreen() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const href = loginHref(locationFromRoute(pathname, searchParams));

  return (
    <div className="auth-gate">
      <div className="auth-gate-card">
        <BrandMark className="auth-gate-mark" />
        <p className="auth-gate-brand">{BRAND_SHORT}</p>
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
