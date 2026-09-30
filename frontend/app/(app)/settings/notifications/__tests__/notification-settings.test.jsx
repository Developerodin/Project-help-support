import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const updateNotificationPrefs = vi.fn();
const refreshUser = vi.fn((u) => Promise.resolve(u));
const user = { id: 'u1', notificationPrefs: {} };

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({ user, refreshUser, impersonation: null }),
}));
vi.mock('@/shared/api/users.js', () => ({
  updateNotificationPrefs: (...args) => updateNotificationPrefs(...args),
  resetNotificationPrefs: vi.fn(),
}));
vi.mock('@/shared/api/notifications.js', () => ({
  getPushConfig: () => Promise.resolve({ enabled: false }),
}));
vi.mock('@/shared/lib/notification-swr.js', () => ({
  mutateNotifications: () => Promise.resolve(),
}));
vi.mock('@/shared/lib/toast.js', () => ({ showToast: vi.fn() }));

const { default: NotificationSettingsPage } = await import('../page.jsx');

describe('Notification settings', () => {
  beforeEach(() => {
    updateNotificationPrefs.mockReset();
    updateNotificationPrefs.mockImplementation((patch) => Promise.resolve({
      ...user,
      notificationPrefs: patch,
    }));
  });

  it('saves without asking when another channel stays on, and says so quietly', async () => {
    const actor = userEvent.setup();
    render(<NotificationSettingsPage />);

    // Assigned: email defaults on, so in-app can go off without a prompt.
    await actor.click(screen.getByRole('checkbox', { name: 'Assigned in app' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(updateNotificationPrefs).toHaveBeenCalledWith({ inApp: { TICKET_ASSIGNED: false } });
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('asks before turning off the last channel for an event', async () => {
    const actor = userEvent.setup();
    render(<NotificationSettingsPage />);

    // New comment: email defaults off, so in-app is the last channel.
    await actor.click(screen.getByRole('checkbox', { name: 'New comment in app' }));

    expect(await screen.findByText('Turn off the last channel?')).toBeInTheDocument();
    expect(updateNotificationPrefs).not.toHaveBeenCalled();
  });
});
