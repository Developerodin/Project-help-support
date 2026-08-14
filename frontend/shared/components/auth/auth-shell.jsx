import { BRAND_NAME, BRAND_TAGLINE, BRAND_DESCRIPTION } from '@/shared/lib/brand.js';
import AuthBackground from './auth-background.jsx';
import BrandMark from '@/shared/components/brand-mark.jsx';

export function AuthBrand() {
  return (
    <header className="auth-header">
      <div className="brand">
        <BrandMark />
        {/* Two spans, one wordmark: the phone stacks them, the desktop wraps
            them as the single line of prose it has always been. */}
        <b>
          <span className="brand-lead">{BRAND_NAME}</span>{' '}
          <span className="brand-tail">{BRAND_TAGLINE}</span>
        </b>
      </div>
      <p className="auth-header__sub">{BRAND_DESCRIPTION}</p>
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
