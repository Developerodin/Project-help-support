import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import RootRedirect from '../page.jsx';

const replace = vi.fn();
let currentUser = null;

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: replace }) }));
vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({ user: currentUser, loading: false }),
}));

describe('RootRedirect', () => {
  beforeEach(() => { replace.mockReset(); currentUser = null; });

  it('sends a signed-out visitor to the login page', async () => {
    render(<RootRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('sends a signed-in user to the ticket list', async () => {
    currentUser = { id: 'u1', role: 'member' };
    render(<RootRedirect />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/tickets'));
  });

  it('renders nothing, so neither destination flashes first', () => {
    const { container } = render(<RootRedirect />);
    expect(container).toBeEmptyDOMElement();
  });
});
