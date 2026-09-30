import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const markNotificationRead = vi.fn(() => Promise.resolve());

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/shared/lib/notification-swr.js', () => ({
  markNotificationRead: (...args) => markNotificationRead(...args),
}));

const { default: NotificationLinkRead, withoutNotifParam } = await import('../notification-link-read.jsx');

const NOTIF_ID = '507f1f77bcf86cd799439011';

describe('NotificationLinkRead', () => {
  afterEach(() => {
    markNotificationRead.mockClear();
    window.history.replaceState(null, '', '/');
  });

  it('drops only notif, keeping the other params and the hash', () => {
    expect(withoutNotifParam('/tickets', `?ticket=WEB-1&project=p1&notif=${NOTIF_ID}&comment=c1`, '#comment-c1'))
      .toBe('/tickets?ticket=WEB-1&project=p1&comment=c1#comment-c1');
    expect(withoutNotifParam('/tickets', `?notif=${NOTIF_ID}`)).toBe('/tickets');
  });

  it('marks the pushed notification read once and cleans the address bar', async () => {
    window.history.replaceState(null, '', `/tickets?ticket=WEB-1&project=p1&notif=${NOTIF_ID}&comment=c1`);
    const { rerender } = render(<NotificationLinkRead />);

    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith(NOTIF_ID));
    expect(`${window.location.pathname}${window.location.search}`)
      .toBe('/tickets?ticket=WEB-1&project=p1&comment=c1');

    rerender(<NotificationLinkRead />);
    expect(markNotificationRead).toHaveBeenCalledTimes(1);
  });

  it('ignores a malformed id but still strips it', async () => {
    window.history.replaceState(null, '', '/tickets?ticket=WEB-1&notif=nope');
    render(<NotificationLinkRead />);

    await waitFor(() => expect(window.location.search).toBe('?ticket=WEB-1'));
    expect(markNotificationRead).not.toHaveBeenCalled();
  });
});
