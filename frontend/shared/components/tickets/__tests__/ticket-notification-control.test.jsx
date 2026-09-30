import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';

const getTicketNotificationSettings = vi.fn();
const updateTicketNotificationSettings = vi.fn();
const showToast = vi.fn();

vi.mock('@/shared/api/notifications.js', () => ({
  getTicketNotificationSettings: (...args) => getTicketNotificationSettings(...args),
  updateTicketNotificationSettings: (...args) => updateTicketNotificationSettings(...args),
}));
vi.mock('@/shared/lib/toast.js', () => ({ showToast: (...args) => showToast(...args) }));

const { default: TicketNotificationControl } = await import('../ticket-notification-control.jsx');

const me = { id: 'u1' };
const ticket = { id: 't1', ticketId: 'WEB-7', assignedTo: { id: 'u1', name: 'Me' } };
const base = { muted: false, following: false, canFollow: true, inAudienceByRole: false };

function renderControl(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TicketNotificationControl ticket={ticket} user={me} {...props} />
    </SWRConfig>,
  );
}

describe('TicketNotificationControl', () => {
  beforeEach(() => {
    getTicketNotificationSettings.mockReset();
    updateTicketNotificationSettings.mockReset();
    showToast.mockReset();
  });

  it('loads settings for the ticket id and explains why updates arrive', async () => {
    getTicketNotificationSettings.mockResolvedValue({ ...base, inAudienceByRole: true });
    const actor = userEvent.setup();
    renderControl();

    await actor.click(await screen.findByRole('button', { name: 'Notifications for WEB-7: Notifications' }));
    expect(getTicketNotificationSettings).toHaveBeenCalledWith('t1');
    expect(screen.getByText("You get updates because you're the assignee.")).toBeInTheDocument();
  });

  it('mutes optimistically and keeps the server reply', async () => {
    getTicketNotificationSettings.mockResolvedValue(base);
    let resolvePut;
    updateTicketNotificationSettings.mockImplementation(() => new Promise((r) => { resolvePut = r; }));
    const actor = userEvent.setup();
    renderControl();

    await actor.click(await screen.findByRole('button', { name: /Notifications for WEB-7/ }));
    await actor.click(screen.getByRole('menuitemcheckbox', { name: /Mute/ }));

    expect(updateTicketNotificationSettings).toHaveBeenCalledWith('t1', { muted: true });
    // Shown before the server answers.
    expect(await screen.findByRole('button', { name: 'Notifications for WEB-7: Muted' })).toBeInTheDocument();
    resolvePut({ ...base, muted: true });
    await waitFor(() => {
      expect(screen.getByRole('menuitemcheckbox', { name: /Muted/ })).toHaveAttribute('aria-checked', 'true');
    });
    expect(screen.getByText("Muted: you'll only hear about mentions and assignments.")).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('rolls a failed mute back and says so', async () => {
    getTicketNotificationSettings.mockResolvedValue(base);
    updateTicketNotificationSettings.mockRejectedValue(new Error('Server said no'));
    const actor = userEvent.setup();
    renderControl();

    await actor.click(await screen.findByRole('button', { name: /Notifications for WEB-7/ }));
    await actor.click(screen.getByRole('menuitemcheckbox', { name: /Mute/ }));

    expect(updateTicketNotificationSettings).toHaveBeenCalledWith('t1', { muted: true });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Server said no', { type: 'error' }));
    expect(screen.getByRole('menuitemcheckbox', { name: /Mute/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Notifications for WEB-7: Notifications' })).toBeInTheDocument();
  });

  it('leaves following to the Watch button instead of repeating it', async () => {
    getTicketNotificationSettings.mockResolvedValue(base);
    const actor = userEvent.setup();
    renderControl();

    await actor.click(await screen.findByRole('button', { name: /Notifications for WEB-7/ }));
    expect(screen.queryByRole('menuitemcheckbox', { name: /Follow/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Watch this ticket for every update/)).toBeInTheDocument();
  });
});
