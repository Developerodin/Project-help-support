import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestTicketFilters, takeTicketFilters } from '../assistant-ticket-filters.js';

describe('assistant hand-off', () => {
  afterEach(() => vi.useRealTimers());

  it('hands a request over once', () => {
    requestTicketFilters({ filters: { priority: 'High' } });
    expect(takeTicketFilters()).toEqual({ filters: { priority: 'High' } });
    expect(takeTicketFilters()).toBeNull();
  });

  it('drops a request nobody took in time, so it cannot fire when the page opens later', () => {
    vi.useFakeTimers();
    requestTicketFilters({ filters: { priority: 'High' } });
    vi.advanceTimersByTime(16000);
    expect(takeTicketFilters()).toBeNull();
  });
});
