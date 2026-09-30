import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import AuthRequiredScreen, { cookieHint } from '../auth-required-screen.jsx';

vi.mock('next/image', () => ({
  default: ({ alt = '', src, className }) => (
    <img alt={alt} src={typeof src === 'string' ? src : ''} className={className} />
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/tickets/board',
  useSearchParams: () => new URLSearchParams('lane=blocked'),
}));

const auth = { effectiveBranding: null, cookiesBlocked: false };
vi.mock('@/shared/contexts/auth-context.jsx', () => ({ useAuth: () => auth }));

describe('AuthRequiredScreen', () => {
  beforeEach(() => { auth.cookiesBlocked = false; });

  it('says cookies are blocked, and how to allow them, when the sign-in just now was not kept', () => {
    auth.cookiesBlocked = true;
    render(<AuthRequiredScreen />);

    expect(screen.getByRole('heading', { name: 'Cookies are blocked' })).toBeInTheDocument();
    // jsdom's user agent is no browser we know, so it gets the general advice.
    expect(screen.getByText(/privacy settings and allow cookies for this site/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Ftickets%2Fboard%3Flane%3Dblocked',
    );
    expect(screen.queryByRole('heading', { name: 'Sign in required' })).not.toBeInTheDocument();
  });

  it('explains that sign-in is required without exposing a raw auth error', () => {
    render(<AuthRequiredScreen />);

    expect(screen.getByRole('heading', { name: 'Sign in required' })).toBeInTheDocument();
    expect(screen.getByText(/your session isn't active/i)).toBeInTheDocument();
    expect(screen.getByText(/sign in to continue to your workspace/i)).toBeInTheDocument();
    expect(screen.getByText('ProwPlus PMS')).toBeInTheDocument();
    expect(screen.queryByText('Please sign in.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });

  it('sends Sign in to login with the current protected path preserved', () => {
    render(<AuthRequiredScreen />);

    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Ftickets%2Fboard%3Flane%3Dblocked',
    );
  });

  it('sends Back to home to the app origin', () => {
    render(<AuthRequiredScreen />);

    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });

  it.each([
    ['Mac Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', /^In Safari:/],
    ['iPhone Safari', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', /^On iPhone or iPad:/],
    ['Chrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', /^In Chrome:/],
    ['Edge', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0', /^In Edge:/],
    ['Firefox', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0', /^In Firefox:/],
    ['Chrome on iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1', /^Check this browser/],
  ])('gives %s its own cookie steps', (_, ua, expected) => {
    expect(cookieHint(ua)).toMatch(expected);
  });
});
