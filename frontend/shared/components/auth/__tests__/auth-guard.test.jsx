import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AUTHENTICATED, AUTH_EXPIRED, AUTH_REQUIRED } from '@/shared/contexts/auth-context.jsx';
import { AuthGuard } from '../auth-guard.jsx';

const auth = {
  status: AUTH_REQUIRED,
  user: null,
  loading: false,
};

vi.mock('@/shared/contexts/auth-context.jsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAuth: () => auth,
  };
});

vi.mock('next/image', () => ({
  default: ({ alt = '', src, className }) => (
    <img alt={alt} src={typeof src === 'string' ? src : ''} className={className} />
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/tickets/board',
  useSearchParams: () => new URLSearchParams(),
}));

describe('AuthGuard', () => {
  beforeEach(() => {
    auth.status = AUTH_REQUIRED;
    auth.user = null;
    auth.loading = false;
  });

  it('replaces the workspace with AuthRequiredScreen on a cold visit', () => {
    render(
      <AuthGuard>
        <p>Protected workspace</p>
      </AuthGuard>,
    );

    expect(screen.getByRole('heading', { name: 'Sign in required' })).toBeInTheDocument();
    expect(screen.queryByText('Protected workspace')).not.toBeInTheDocument();
    expect(screen.queryByText('Please sign in.')).not.toBeInTheDocument();
  });

  it('renders the workspace when authenticated', () => {
    auth.status = AUTHENTICATED;
    auth.user = { id: 'u1' };
    render(
      <AuthGuard>
        <p>Protected workspace</p>
      </AuthGuard>,
    );

    expect(screen.getByText('Protected workspace')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign in required' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps the workspace and overlays SessionExpiredScreen when the session dies', () => {
    auth.status = AUTH_EXPIRED;
    auth.user = { id: 'u1' };
    render(
      <AuthGuard>
        <p>Protected workspace</p>
      </AuthGuard>,
    );

    expect(screen.getByText('Protected workspace')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Session expired' })).toBeInTheDocument();
    expect(screen.queryByText('Please sign in.')).not.toBeInTheDocument();
  });
});
