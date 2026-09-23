'use client';

import { useEffect, useState } from 'react';
import Icon from '@/shared/components/icons.jsx';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { resolvePwaDisplayName } from '@/shared/lib/branding.js';

const DISMISS_KEY = 'pwa-install-dismissed';

function isStandaloneDisplay() {
  if (typeof window === 'undefined') return true;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  if (window.navigator.standalone === true) return true;
  return false;
}

function wasDismissedThisSession() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Chromium-only install affordance. Captures `beforeinstallprompt`, never shown
 * on iOS/Safari/Firefox (no event), standalone, or after session dismiss.
 */
export default function PwaInstallButton() {
  const { effectiveBranding } = useAuth();
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const installName = resolvePwaDisplayName(effectiveBranding);

  useEffect(() => {
    if (isStandaloneDisplay() || wasDismissedThisSession()) return;

    const onBeforeInstall = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  if (!visible || !deferredPrompt) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch { /* ignore */ }
    setDeferredPrompt(null);
    setVisible(false);
  };

  const install = async () => {
    const promptEvent = deferredPrompt;
    setDeferredPrompt(null);
    setVisible(false);
    try {
      await promptEvent.prompt();
      await promptEvent.userChoice;
    } catch { /* user closed sheet; stay hidden for this visit */ }
  };

  return (
    <div className="pwa-install">
      <button
        type="button"
        className="btn pwa-install__btn"
        aria-label={`Install ${installName}`}
        onClick={install}
      >
        {`Install ${installName}`}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-ico pwa-install__dismiss"
        aria-label="Dismiss install prompt"
        onClick={dismiss}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
