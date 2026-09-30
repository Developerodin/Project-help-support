'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import BrandMark from '@/shared/components/brand-mark.jsx';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { formatBrandDisplayName } from '@/shared/lib/branding.js';
import { loginHref, locationFromRoute } from '@/shared/lib/login-redirect.js';

/**
 * Where this browser keeps the switch, from its user agent. Order matters: Edge
 * and Chrome both say "Safari", Edge also says "Chrome", and every iPhone
 * browser is WebKit, so only a plain Safari UA gets the Safari steps.
 * ponytail: UA sniffing, fine for a hint; a wrong guess still reads as advice.
 */
export function cookieHint(ua = '') {
  if (/Edg\//.test(ua)) return 'In Edge: Settings → Cookies and site permissions → Manage and delete cookies and site data, then allow this site.';
  if (/Firefox\//.test(ua)) return 'In Firefox: Settings → Privacy & Security → Cookies and Site Data → Manage Exceptions, then allow this site.';
  if (/Chrome\//.test(ua)) return 'In Chrome: Settings → Privacy and security → Site settings → On-device site data, then allow this site (remove it from “Not allowed”).';
  if (/Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) {
    return /iPhone|iPad|iPod/.test(ua)
      ? 'On iPhone or iPad: Settings app → Safari → turn off “Block All Cookies”.'
      : 'In Safari: Settings → Privacy → turn off “Block all cookies”.';
  }
  return 'Check this browser’s privacy settings and allow cookies for this site.';
}

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
              {cookieHint(typeof navigator === 'undefined' ? '' : navigator.userAgent)}
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
