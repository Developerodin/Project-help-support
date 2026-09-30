import {
  afterEach, describe, expect, test, vi,
} from 'vitest';
import { showToast } from './toast.js';

afterEach(() => {
  document.getElementById('app-toast-stack')?.remove();
  vi.useRealTimers();
});

const all = () => document.querySelectorAll('.toast');
const live = () => [...all()].filter((el) => !el._toastClosing);

describe('showToast', () => {
  test('announces through one polite live region on the container', () => {
    showToast('First');
    showToast('Second');
    expect(document.getElementById('app-toast-stack').getAttribute('aria-live')).toBe('polite');
    expect(all()).toHaveLength(2);
  });

  test('keeps at most three live, evicting the oldest', () => {
    vi.useFakeTimers();
    for (const n of [1, 2, 3, 4, 5]) showToast(`Reply ${n}`);
    expect(live()).toHaveLength(3);
    vi.advanceTimersByTime(200);
    expect(all()).toHaveLength(3);
  });

  // The regression that made every error toast in the app flash and vanish: an
  // options object landed where a duration was expected and became NaN.
  test('an options object is not mistaken for a duration', () => {
    vi.useFakeTimers();
    showToast('Could not save', { type: 'error' });
    vi.advanceTimersByTime(80);
    expect(all()).toHaveLength(1);
    expect(document.querySelector('.toast--error')).not.toBeNull();
  });

  test('tag and detail make a quieter second line, the detail kept whole on hover', () => {
    showToast('Asha replied', { tag: 'WEB-12', detail: 'Login page breaks on Safari' });
    expect(document.querySelector('.toast-lead').textContent).toBe('Asha replied');
    expect(document.querySelector('.toast-tag').textContent).toBe('WEB-12');
    expect(document.querySelector('.toast-detail').title).toBe('Login page breaks on Safari');
    showToast('Saved');
    expect(document.querySelectorAll('.toast-sub')).toHaveLength(1);
  });

  test('the same key rewrites the toast showing, restarts its time, and closes once', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    showToast('Asha replied', { key: 'reply:WEB-12', durationMs: 8000, onClose });
    vi.advanceTimersByTime(6000);
    showToast('2 replies from Asha', { key: 'reply:WEB-12', durationMs: 8000, onClose });
    expect(live()).toHaveLength(1);
    expect(document.querySelector('.toast-lead').textContent).toBe('2 replies from Asha');
    vi.advanceTimersByTime(6000);
    expect(live()).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(live()).toHaveLength(0);
    expect(onClose).toHaveBeenCalledOnce();
  });

  test('when full, the toast being read is not the one pushed out', () => {
    vi.useFakeTimers();
    showToast('One');
    showToast('Two');
    showToast('Three');
    const [first, second] = live();
    first.dispatchEvent(new MouseEvent('mouseenter'));
    showToast('Four');
    expect(first._toastClosing).toBeFalsy();
    expect(second._toastClosing).toBe(true);
  });

  test('hover and focus together pause once, not twice', () => {
    vi.useFakeTimers();
    showToast('Held', 5000);
    const [el] = live();
    vi.advanceTimersByTime(2000);
    el.dispatchEvent(new MouseEvent('mouseenter'));
    el.dispatchEvent(new FocusEvent('focusin'));
    vi.advanceTimersByTime(10_000);
    el.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(2900);
    expect(live()).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(live()).toHaveLength(0);
  });

  test('a numeric second argument still means milliseconds', () => {
    vi.useFakeTimers();
    showToast('Legacy', 300);
    vi.advanceTimersByTime(150);
    expect(all()).toHaveLength(1);
    vi.advanceTimersByTime(350);
    expect(all()).toHaveLength(0);
  });

  test('hover holds it open, and leaving resumes', () => {
    vi.useFakeTimers();
    showToast('New reply on TES4-2', { durationMs: 300 });
    const el = document.querySelector('.toast');

    el.dispatchEvent(new window.MouseEvent('mouseenter'));
    vi.advanceTimersByTime(60_000);
    expect(all()).toHaveLength(1);

    el.dispatchEvent(new window.MouseEvent('mouseleave'));
    vi.advanceTimersByTime(1200 + 200);
    expect(all()).toHaveLength(0);
  });

  test('keyboard focus pauses it too', () => {
    vi.useFakeTimers();
    showToast('Focus me', { durationMs: 300 });
    document.querySelector('.toast')
      .dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
    vi.advanceTimersByTime(60_000);
    expect(all()).toHaveLength(1);
  });

  test('the close button is labelled and dismisses', () => {
    vi.useFakeTimers();
    showToast('Dismiss me');
    const close = document.querySelector('.toast-close');
    expect(close.getAttribute('aria-label')).toBe('Dismiss notification');
    close.click();
    vi.advanceTimersByTime(220);
    expect(all()).toHaveLength(0);
  });

  test('the action fires and closes the toast', () => {
    vi.useFakeTimers();
    const onClick = vi.fn();
    showToast('New reply on TES4-2', { action: { label: 'View', onClick } });
    document.querySelector('.toast-action').click();
    expect(onClick).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(220);
    expect(all()).toHaveLength(0);
  });
});
