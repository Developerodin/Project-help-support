import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let search = 'token=abc';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('@/shared/components/auth/auth-shell.jsx', () => ({
  default: ({ children }) => <main>{children}</main>,
  AuthBrand: () => null,
}));

const fetchMock = vi.fn();
const json = (status, body) => Promise.resolve(new Response(
  body === undefined ? null : JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json' } },
));

const { default: UnsubscribePage } = await import('../page.jsx');

describe('Unsubscribe page', () => {
  beforeEach(() => {
    search = 'token=abc';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('only reads on load, then unsubscribes and resubscribes on click without auth', async () => {
    fetchMock.mockImplementation((url, init = {}) => {
      if ((init.method || 'GET') === 'GET') return json(200, { email: 'p***@example.com', paused: false });
      return json(204);
    });
    const actor = userEvent.setup();
    render(<UnsubscribePage />);

    expect(await screen.findByRole('heading', { name: 'Unsubscribe from ticket email?' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [getUrl, getInit] = fetchMock.mock.calls[0];
    expect(getUrl).toBe('http://localhost:4000/v1/notifications/email/unsubscribe?token=abc');
    expect(getInit.method).toBe('GET');
    expect(getInit.headers?.Authorization).toBeUndefined();
    expect(getInit.credentials).toBe('omit');

    await actor.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(await screen.findByText(/You're unsubscribed from ticket email for p\*\*\*@example\.com/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:4000/v1/notifications/email/unsubscribe?token=abc',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.getByRole('link', { name: 'Manage notification settings' })).toHaveAttribute('href', '/settings/notifications');

    await actor.click(screen.getByRole('button', { name: 'Resubscribe' }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:4000/v1/notifications/email/resubscribe?token=abc',
      expect.objectContaining({ method: 'POST' }),
    ));
    expect(await screen.findByRole('button', { name: 'Unsubscribe' })).toBeInTheDocument();
  });

  it('shows a friendly message for a bad token', async () => {
    fetchMock.mockImplementation(() => json(400, { error: { code: 'INVALID_TOKEN', message: 'bad' } }));
    render(<UnsubscribePage />);
    expect(await screen.findByRole('heading', { name: "This link doesn't work" })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unsubscribe' })).not.toBeInTheDocument();
  });

  it('does not call the API when the token is missing', async () => {
    search = '';
    render(<UnsubscribePage />);
    expect(await screen.findByRole('heading', { name: "This link doesn't work" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
