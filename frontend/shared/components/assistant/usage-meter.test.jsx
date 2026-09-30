import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import UsageMeter, { formatResetIn, usageSummary } from './usage-meter.jsx';

const at = Date.parse('2026-09-23T14:53:00Z');
const resetsAt = '2026-09-23T18:30:00.000Z'; // midnight IST, 3 hr 37 min later

describe('UsageMeter', () => {
  afterEach(() => vi.useRealTimers());

  it('says how long until the allowance resets', () => {
    expect(formatResetIn(resetsAt, at)).toBe('3 hr 37 min');
    expect(formatResetIn(resetsAt, Date.parse('2026-09-23T18:00:00Z'))).toBe('30 min');
    expect(formatResetIn(resetsAt, Date.parse('2026-09-23T17:30:00Z'))).toBe('1 hr');
    expect(formatResetIn(resetsAt, Date.parse('2026-09-23T18:29:50Z'))).toBe('under a minute');
  });

  it('summarises usage like "29% of ₹100 daily limit · Resets in 3 hr 37 min"', () => {
    expect(usageSummary({ percent: 29, limitInr: 100, resetsAt }, at)).toBe('29% of ₹100 daily limit · Resets in 3 hr 37 min');
    expect(usageSummary({ percent: 100, limitInr: 100, resetsAt }, at)).toBe('Daily ₹100 limit reached · Resets in 3 hr 37 min');
  });

  it('is a labelled meter that warns from 80% and turns red at the limit', () => {
    vi.useFakeTimers({ now: at });
    const { rerender } = render(<UsageMeter usage={{ percent: 29, limitInr: 100, resetsAt }} />);
    const meter = screen.getByRole('meter', { name: 'Assistant usage today' });
    expect(meter.getAttribute('aria-valuenow')).toBe('29');
    expect(meter.getAttribute('aria-valuetext')).toMatch(/29% of ₹100 daily limit/);
    expect(screen.getByRole('tooltip').textContent).toContain('Usage');
    expect(meter.className).toBe('usage-meter');

    rerender(<UsageMeter usage={{ percent: 85, limitInr: 100, resetsAt }} />);
    expect(meter.className).toContain('is-high');
    rerender(<UsageMeter usage={{ percent: 100, limitInr: 100, resetsAt }} />);
    expect(meter.className).toContain('is-full');
  });

  it('asks for fresh numbers once midnight passes', () => {
    vi.useFakeTimers({ now: Date.parse('2026-09-23T18:29:40Z') });
    const onReset = vi.fn();
    render(<UsageMeter usage={{ percent: 100, limitInr: 100, resetsAt }} onReset={onReset} />);
    expect(onReset).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(onReset).toHaveBeenCalled();
  });

  it('renders nothing until usage is known', () => {
    const { container } = render(<UsageMeter usage={null} />);
    expect(container.innerHTML).toBe('');
  });
});
