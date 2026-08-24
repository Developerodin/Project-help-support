'use client';

import { useAuth } from '@/shared/contexts/auth-context.jsx';
import AuthBackground from './auth-background.jsx';
import BrandMark from '@/shared/components/brand-mark.jsx';
import { brandDescription, formatBrandDisplayName } from '@/shared/lib/branding.js';

export function AuthBrand() {
  const { effectiveBranding } = useAuth();
  const name = formatBrandDisplayName(effectiveBranding?.name);

  return (
    <header className="auth-header">
      <div className="brand">
        <BrandMark logoUrl={effectiveBranding?.logoUrl} />
        <b>{name}</b>
      </div>
      <p className="auth-header__sub">{brandDescription(effectiveBranding)}</p>
    </header>
  );
}

/** Split auth surface: focused form panel left, 4D visual right. */
export default function AuthFrame({ children }) {
  return (
    <div className="auth-scene auth">
      <div className="auth-split">
        <div className="auth-panel auth-panel--form">
          <div className="auth-form">{children}</div>
        </div>
        <div className="auth-panel auth-panel--viz" aria-hidden="true">
          <AuthBackground />
        </div>
      </div>
    </div>
  );
}
