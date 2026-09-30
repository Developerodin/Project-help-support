import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NOTIFICATION_EVENTS } from '@pms/shared';

const updateNotificationPrefs = vi.fn();
const refreshUser = vi.fn((u) => Promise.resolve(u));
const showToast = vi.fn();
const authState = { user: { id: 'u1', notificationPrefs: {} } };

vi.mock('@/shared/contexts/auth-context.jsx', () => ({
  useAuth: () => ({ user: authState.user, refreshUser, impersonation: null }),
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
vi.mock('@/shared/lib/toast.js', () => ({ showToast: (...args) => showToast(...args) }));

const { default: NotificationSettingsPage } = await import('../page.jsx');

const all = (value) => Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, value]));
const only = (...events) => Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e, events.includes(e)]));
const detectedZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe('Notification settings: presets, email and quiet hours', () => {
  beforeEach(() => {
    authState.user = { id: 'u1', notificationPrefs: {} };
    showToast.mockReset();
    updateNotificationPrefs.mockReset();
    // The server returns the whole user; here the patch stands in for the stored prefs.
    updateNotificationPrefs.mockImplementation((patch) => Promise.resolve({
      id: 'u1',
      notificationPrefs: { ...authState.user.notificationPrefs, ...patch },
    }));
  });

  it('sends each preset as full email and in-app maps and marks it pressed', async () => {
    const actor = userEvent.setup();
    render(<NotificationSettingsPage />);

    for (const button of ["Only what's for me", 'Everything', 'Quiet']) {
      expect(screen.getByRole('button', { name: button })).toHaveAttribute('aria-pressed', 'false');
    }

    await actor.click(screen.getByRole('button', { name: "Only what's for me" }));
    await waitFor(() => expect(updateNotificationPrefs).toHaveBeenLastCalledWith({
      email: only('TICKET_MENTIONED', 'TICKET_ASSIGNED'),
      inApp: all(true),
    }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Only what's for me" })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await actor.click(screen.getByRole('button', { name: 'Quiet' }));
    await waitFor(() => expect(updateNotificationPrefs).toHaveBeenLastCalledWith({
      email: only('TICKET_MENTIONED'),
      inApp: only('TICKET_MENTIONED', 'TICKET_ASSIGNED', 'TICKET_COMMENTED'),
    }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Quiet' })).toHaveAttribute('aria-pressed', 'true');
    });

    await actor.click(screen.getByRole('button', { name: 'Everything' }));
    await waitFor(() => expect(updateNotificationPrefs).toHaveBeenLastCalledWith({
      email: all(true), inApp: all(true),
    }));
  });

  it('detects a stored preset on load', () => {
    authState.user = { id: 'u1', notificationPrefs: { email: all(true), inApp: all(true) } };
    render(<NotificationSettingsPage />);
    expect(screen.getByRole('button', { name: 'Everything' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Quiet' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('saves the email frequency with the detected time zone when none is stored', async () => {
    const actor = userEvent.setup();
    render(<NotificationSettingsPage />);

    expect(screen.getByLabelText('Time zone')).toHaveValue(detectedZone);
    await actor.selectOptions(screen.getByLabelText('Email me'), 'daily');

    await waitFor(() => expect(updateNotificationPrefs).toHaveBeenCalledWith({
      emailFrequency: 'daily', timeZone: detectedZone,
    }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByLabelText('Email me')).toHaveValue('daily');
  });

  it('puts the old frequency back and shows an error toast when the save fails', async () => {
    authState.user = { id: 'u1', notificationPrefs: { timeZone: 'UTC' } };
    updateNotificationPrefs.mockRejectedValueOnce(new Error('nope'));
    const actor = userEvent.setup();
    render(<NotificationSettingsPage />);

    await actor.selectOptions(screen.getByLabelText('Email me'), 'hourly');

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.any(String), { type: 'error' }));
    expect(updateNotificationPrefs).toHaveBeenCalledWith({ emailFrequency: 'hourly' });
    expect(screen.getByLabelText('Email me')).toHaveValue('immediate');
  });

  it('saves quiet hours as one object and times on blur', async () => {
    authState.user = { id: 'u1', notificationPrefs: { timeZone: 'UTC' } };
    const actor = userEvent.setup();
    render(<NotificationSettingsPage />);

    await actor.click(screen.getByRole('switch', { name: /Turn on quiet hours/ }));
    await waitFor(() => expect(updateNotificationPrefs).toHaveBeenLastCalledWith({
      quietHours: { enabled: true, start: '22:00', end: '08:00', allowUrgent: true },
    }));

    const until = screen.getByLabelText('Until');
    fireEvent.change(until, { target: { value: '07:30' } });
    expect(updateNotificationPrefs).toHaveBeenCalledTimes(1);
    fireEvent.blur(until);
    await waitFor(() => expect(updateNotificationPrefs).toHaveBeenLastCalledWith({
      quietHours: { enabled: true, start: '22:00', end: '07:30', allowUrgent: true },
    }));

    await actor.click(screen.getByRole('checkbox', { name: 'Still notify me for mentions and assignments' }));
    await waitFor(() => expect(updateNotificationPrefs).toHaveBeenLastCalledWith({
      quietHours: { enabled: true, start: '22:00', end: '07:30', allowUrgent: false },
    }));
  });

  it('pauses email and offers to resume it from a banner', async () => {
    const actor = userEvent.setup();
    render(<NotificationSettingsPage />);

    await actor.click(screen.getByRole('switch', { name: /Pause all ticket email/ }));
    await waitFor(() => expect(updateNotificationPrefs).toHaveBeenLastCalledWith({ emailPaused: true }));
    expect(await screen.findByText('Ticket email is paused')).toBeInTheDocument();

    await actor.click(screen.getByRole('button', { name: 'Resume email' }));
    await waitFor(() => expect(updateNotificationPrefs).toHaveBeenLastCalledWith({ emailPaused: false }));
    await waitFor(() => expect(screen.queryByText('Ticket email is paused')).not.toBeInTheDocument());
  });
});
