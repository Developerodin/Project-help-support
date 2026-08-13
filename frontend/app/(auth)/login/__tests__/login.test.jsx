import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginPage from '../page.jsx';

const login = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: push }) }));
vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({ login, user: null, loading: false }),
}));

describe('LoginPage', () => {
  beforeEach(() => { login.mockReset(); push.mockReset(); });

  it('submits the credentials and navigates to the ticket list', async () => {
    login.mockResolvedValueOnce({ id: 'u1', role: 'member' });
    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.type(screen.getByPlaceholderText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('ada@example.com', 'correct-horse'));
    expect(push).toHaveBeenCalledWith('/tickets');
  });

  it('shows the server message and does not leak whether the account exists', async () => {
    login.mockRejectedValueOnce({
      status: 401, code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password',
    });
    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText(/email/i), 'nobody@example.com');
    await userEvent.type(screen.getByPlaceholderText('Password'), 'whatever');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/incorrect email or password/i)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('surfaces a rate-limit response as itself', async () => {
    login.mockRejectedValueOnce({
      status: 429, code: 'TOO_MANY_REQUESTS', message: 'Try again later',
    });
    render(<LoginPage />);

    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.type(screen.getByPlaceholderText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText(/try again later/i)).toBeInTheDocument();
  });
});
