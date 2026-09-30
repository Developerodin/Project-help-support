import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const updateTicketNotificationSettings = vi.fn();
const showToast = vi.fn();

vi.mock('@/shared/api/notifications.js', () => ({
  updateTicketNotificationSettings: (...args) => updateTicketNotificationSettings(...args),
}));
vi.mock('@/shared/lib/toast.js', () => ({ showToast: (...args) => showToast(...args) }));

const { default: NotificationTicketCard } = await import('../NotificationTicketCard.jsx');
const { default: NotificationRow } = await import('../notification-row.jsx');

const item = {
  id: 'n1',
  event: 'TICKET_COMMENTED',
  title: 'New comment',
  link: '/tickets?ticket=WEB-9',
  ticket: { id: 't9', ticketId: 'WEB-9', title: 'Checkout' },
  createdAt: '2026-09-01T00:00:00.000Z',
};

describe('Mute ticket from notifications', () => {
  beforeEach(() => {
    updateTicketNotificationSettings.mockReset();
    updateTicketNotificationSettings.mockImplementation((id, body) => Promise.resolve({ muted: body.muted }));
    showToast.mockReset();
  });

  it('mutes from an inbox card and undoes from the toast', async () => {
    const actor = userEvent.setup();
    render(<NotificationTicketCard group={{ ticketKey: 'WEB-9', items: [item], latest: item }} />);

    await actor.click(screen.getByRole('button', { name: 'Mute WEB-9' }));
    expect(updateTicketNotificationSettings).toHaveBeenCalledWith('t9', { muted: true });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Muted WEB-9'),
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
    ));

    showToast.mock.calls[0][1].action.onClick();
    expect(updateTicketNotificationSettings).toHaveBeenLastCalledWith('t9', { muted: false });
  });

  it('offers mute on bell rows only when asked, and reports failure', async () => {
    updateTicketNotificationSettings.mockRejectedValue(new Error('Nope'));
    const actor = userEvent.setup();
    const { rerender } = render(<NotificationRow item={item} />);
    expect(screen.queryByRole('button', { name: 'Mute WEB-9' })).not.toBeInTheDocument();

    rerender(<NotificationRow item={item} showMute />);
    await actor.click(screen.getByRole('button', { name: 'Mute WEB-9' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Nope', { type: 'error' }));
  });
});
