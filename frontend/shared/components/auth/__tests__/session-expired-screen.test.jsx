import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SessionExpiredScreen from '../session-expired-screen.jsx';

vi.mock('next/image', () => ({
  default: ({ alt = '', src, className }) => (
    <img alt={alt} src={typeof src === 'string' ? src : ''} className={className} />
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/tickets/board',
  useSearchParams: () => new URLSearchParams('ticket=MOB-243'),
}));

describe('SessionExpiredScreen', () => {
  it('interrupts the workspace with a session-expired dialog', () => {
    render(<SessionExpiredScreen />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Session expired' })).toBeInTheDocument();
    expect(screen.getByText(/your session has expired/i)).toBeInTheDocument();
    expect(screen.getByText(/please sign in again to continue/i)).toBeInTheDocument();
    expect(screen.queryByText('Please sign in.')).not.toBeInTheDocument();
  });

  it('sends Sign in again to login with the exact current route', () => {
    render(<SessionExpiredScreen />);

    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute(
      'href',
      '/login?redirect=%2Ftickets%2Fboard%3Fticket%3DMOB-243',
    );
  });
});
