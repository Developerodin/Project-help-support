import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from './use-debounced-value.js';

afterEach(() => { vi.useRealTimers(); });

describe('useDebouncedValue', () => {
  it('returns the first value immediately', () => {
    // A mount is not a change; delaying it would blank the first render.
    const { result } = renderHook(() => useDebouncedValue('admin', 300));
    expect(result.current).toBe('admin');
  });

  it('trails a change by the delay', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    expect(result.current).toBe('a');

    act(() => { vi.advanceTimersByTime(299); });
    expect(result.current).toBe('a');

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe('ab');
  });

  it('collapses a burst of changes into one update', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: '' } },
    );

    for (const value of ['a', 'ad', 'adm', 'admi', 'admin']) {
      rerender({ value });
      act(() => { vi.advanceTimersByTime(50) });
    }

    // 5 keystrokes 50ms apart: still nothing, because none of them settled.
    expect(result.current).toBe('');

    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe('admin');
  });

  it('settles back to the original value without an extra update', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: 'a' } },
    );

    rerender({ value: 'ab' });
    rerender({ value: 'a' });
    act(() => { vi.advanceTimersByTime(300); });

    expect(result.current).toBe('a');
  });
});
