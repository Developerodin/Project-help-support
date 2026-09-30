import { describe, it, expect, beforeEach } from 'vitest';
import { applyDocumentBranding } from '../branding.js';

/**
 * The favicon link Next renders from app metadata is a React hoistable: React
 * holds a fiber for it and removes it itself on unmount. Deleting it from here
 * leaves that fiber pointing at a detached node, and the next unmount dies with
 * `Cannot read properties of null (reading 'removeChild')` — which killed the
 * in-flight navigation after starting impersonation.
 */
describe('applyDocumentBranding', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
  });

  it('never removes an icon link it did not create', () => {
    const reactOwned = document.createElement('link');
    reactOwned.setAttribute('rel', 'icon');
    reactOwned.setAttribute('href', '/icon.png?abc123');
    document.head.appendChild(reactOwned);

    applyDocumentBranding({ type: 'company', name: 'Acme', faviconUrl: '/acme.png' });

    expect(reactOwned.parentNode).toBe(document.head);
  });

  it('reuses its own link instead of stacking one up per session change', () => {
    applyDocumentBranding({ type: 'company', name: 'Acme', faviconUrl: '/acme.png' });
    applyDocumentBranding({ type: 'company', name: 'Globex', faviconUrl: '/globex.png' });
    applyDocumentBranding({ type: 'neutral' });

    const owned = document.head.querySelectorAll('link[data-brand-icon]');
    expect(owned).toHaveLength(1);
    expect(owned[0].getAttribute('href')).toBe('/branding/pp_icons.png');
  });
});
