import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AuthRequiredScreen from '../auth-required-screen.jsx';

vi.mock('next/image', () => ({
  default: ({ alt = '', src, className }) => (
    <img alt={alt} src={typeof src === 'string' ? src : ''} className={className} />
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/tickets/board',
  useSearchParams: () => new URLSearchParams('lane=blocked'),
}));

describe('AuthRequiredScreen', () => {
  it('explains that sign-in is required without exposing a raw auth error', () => {
    render(<AuthRequiredScreen />);

    expect(screen.getByRole('heading', { name: 'Sign in required' })).toBeInTheDocument();
    expect(screen.getByText(/your session isn't active/i)).toBeInTheDocument();
    expect(screen.getByText(/sign in to continue to your workspace/i)).toBeInTheDocument();
    expect(screen.getByText('PROWPLUS PMS')).toBeInTheDocument();
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
});
