import { describe, it, expect } from 'vitest';
import { loginHref, resolveLoginRedirect, sanitizeRedirect, locationFromRoute } from '../login-redirect.js';

describe('sanitizeRedirect', () => {
  it('accepts an in-app path with its query string', () => {
    expect(sanitizeRedirect('/tickets/board?lane=blocked')).toBe('/tickets/board?lane=blocked');
  });

  it('rejects protocol-relative and off-site values', () => {
    expect(sanitizeRedirect('//evil.example/phish')).toBe(null);
    expect(sanitizeRedirect('https://evil.example/phish')).toBe(null);
    expect(sanitizeRedirect('tickets/board')).toBe(null);
  });

  it('rejects auth routes so login cannot loop', () => {
    expect(sanitizeRedirect('/login')).toBe(null);
    expect(sanitizeRedirect('/login?redirect=/tickets')).toBe(null);
    expect(sanitizeRedirect('/forgot-password')).toBe(null);
    expect(sanitizeRedirect('/reset-password')).toBe(null);
    expect(sanitizeRedirect('/invite/accept')).toBe(null);
  });
});

describe('loginHref', () => {
  it('encodes the current protected path for the login screen', () => {
    expect(loginHref('/tickets/board')).toBe('/login?redirect=%2Ftickets%2Fboard');
  });

  it('preserves the query string on the intended destination', () => {
    expect(loginHref('/tickets?status=live')).toBe('/login?redirect=%2Ftickets%3Fstatus%3Dlive');
  });
});

describe('resolveLoginRedirect', () => {
  it('returns the sanitized path after a successful sign-in', () => {
    expect(resolveLoginRedirect('/tickets/board')).toBe('/tickets/board');
  });

  it('falls back to the ticket list when the redirect is missing or unsafe', () => {
    expect(resolveLoginRedirect(null)).toBe('/tickets');
    expect(resolveLoginRedirect('https://evil.example')).toBe('/tickets');
  });
});

describe('locationFromRoute', () => {
  it('joins pathname and search params into the current location', () => {
    expect(locationFromRoute('/tickets/board', new URLSearchParams('lane=blocked')))
      .toBe('/tickets/board?lane=blocked');
    expect(locationFromRoute('/tickets', new URLSearchParams())).toBe('/tickets');
  });
});
