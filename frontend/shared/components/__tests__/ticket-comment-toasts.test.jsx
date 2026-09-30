import { render } from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

const showToast = vi.fn();
const mutateNotifications = vi.fn();
const push = vi.fn();
/** Whatever the component registered with the realtime stream. */
let emit;

vi.mock('@/shared/lib/toast.js', () => ({ showToast: (...args) => showToast(...args) }));
vi.mock('@/shared/lib/notification-swr.js', () => ({
  mutateNotifications: (...args) => mutateNotifications(...args),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/shared/contexts/realtime-context.jsx', () => ({
  useRealtimeEvent: (handler) => { emit = handler; },
}));

const TicketCommentToasts = (await import('../ticket-comment-toasts.jsx')).default;

const comment = (over = {}) => ({
  type: 'ticket.comment', ticketId: 'TES4-2', projectId: 'p1', actorName: 'Harsh Bansal', ...over,
});

beforeEach(() => {
  // The mocked toast never closes, so close each one here: that is what clears
  // the per-ticket reply count between tests.
  for (const [, opts] of showToast.mock.calls) opts?.onClose?.();
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/tickets');
  render(<TicketCommentToasts />);
});

describe('TicketCommentToasts', () => {
  it('says who replied, then the ticket id and its title underneath', () => {
    emit(comment({ title: 'Login page breaks on Safari' }));
    expect(showToast).toHaveBeenCalledWith('Harsh Bansal replied', expect.objectContaining({
      tag: 'TES4-2', detail: 'Login page breaks on Safari',
    }));
  });

  it('folds a burst on one ticket into one popup that counts and names who replied', () => {
    emit(comment());
    emit(comment({ actorName: 'Asha Rao' }));
    emit(comment());
    const keys = showToast.mock.calls.map(([, opts]) => opts.key);
    expect(new Set(keys)).toEqual(new Set(['reply:TES4-2']));
    expect(showToast.mock.calls.at(-1)[0]).toBe('3 replies from Harsh Bansal and Asha Rao');

    // Once that popup goes, the next reply starts over.
    showToast.mock.calls.at(-1)[1].onClose();
    emit(comment());
    expect(showToast.mock.calls.at(-1)[0]).toBe('Harsh Bansal replied');
  });

  it('keeps replies on different tickets apart', () => {
    emit(comment());
    emit(comment({ ticketId: 'TES4-9' }));
    expect(showToast.mock.calls.map(([, opts]) => opts.key)).toEqual(['reply:TES4-2', 'reply:TES4-9']);
    expect(showToast.mock.calls[1][0]).toBe('Harsh Bansal replied');
  });

  it('never announces your own comment (posted through the assistant)', () => {
    emit(comment({ self: true }));
    expect(showToast).not.toHaveBeenCalled();
    expect(mutateNotifications).not.toHaveBeenCalled();
  });

  it('drops the attribution when the payload has no name', () => {
    emit(comment({ actorName: null }));
    expect(showToast.mock.calls[0][0]).toBe('New reply');
    expect(showToast.mock.calls[0][1].tag).toBe('TES4-2');
  });

  it('refreshes the bell rather than letting it lag a poll behind', () => {
    emit(comment());
    expect(mutateNotifications).toHaveBeenCalledOnce();
  });

  // The drawer shows the reply itself and marks it read as you read it, so a
  // popup about the ticket already on screen is noise.
  it('stays quiet for the ticket already open', () => {
    window.history.replaceState({}, '', '/tickets?ticket=TES4-2');
    emit(comment());
    expect(showToast).not.toHaveBeenCalled();
    // The badge still has to move even when the popup is suppressed.
    expect(mutateNotifications).toHaveBeenCalledOnce();
  });

  it('still toasts when a different ticket is open', () => {
    window.history.replaceState({}, '', '/tickets?ticket=TES4-9');
    emit(comment());
    expect(showToast).toHaveBeenCalledOnce();
  });

  it('refreshes the bell, without a popup, when a notification is created', () => {
    emit({ type: 'notification.created' });
    expect(mutateNotifications).toHaveBeenCalledOnce();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('ignores events that are not comments', () => {
    emit({ type: 'ticket.updated', projectId: 'p1' });
    emit({ type: 'ticket.comment' });
    emit(null);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('the Open action deep-links to the ticket', () => {
    emit(comment());
    showToast.mock.calls[0][1].action.onClick();
    expect(push).toHaveBeenCalledWith('/tickets?ticket=TES4-2');
  });
});
