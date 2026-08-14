import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationBell from '../notification-bell.jsx';
import * as notificationsApi from '@/shared/api/notifications.js';

vi.mock('@/shared/api/notifications.js', () => ({
  listNotifications: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
}));

describe('NotificationBell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationsApi.listNotifications.mockImplementation((params = {}) => {
      if (params.unread) {
        return Promise.resolve({ totalResults: 2, results: [{ id: '1', readAt: null }] });
      }
      return Promise.resolve({
        totalResults: 2,
        results: [
          {
            id: '1',
            title: 'WEB-1 was assigned',
            body: 'Broken login',
            link: 'http://localhost:3000/tickets?ticket=WEB-1',
            readAt: null,
            createdAt: new Date().toISOString(),
          },
        ],
      });
    });
  });

  it('shows unread badge count', async () => {
    render(<NotificationBell />);
    expect(await screen.findByLabelText('2 unread notifications')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('opens dropdown with recent notifications', async () => {
    const user = userEvent.setup();
    render(<NotificationBell />);

    await user.click(await screen.findByLabelText('2 unread notifications'));

    expect(await screen.findByText('WEB-1 was assigned')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /View all notifications/i })).toHaveAttribute('href', '/notifications');
  });

  it('marks a notification read when clicked', async () => {
    const user = userEvent.setup();
    notificationsApi.markRead.mockResolvedValue({});
    render(<NotificationBell />);

    await user.click(await screen.findByLabelText('2 unread notifications'));
    await user.click(screen.getByText('WEB-1 was assigned'));

    await waitFor(() => {
      expect(notificationsApi.markRead).toHaveBeenCalledWith('1');
    });
  });
});
