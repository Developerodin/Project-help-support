import { describe, it, expect } from 'vitest';
import { ticketFromSearch, withTicketParam, withoutTicketParam } from '../deep-link.js';

describe('deep links', () => {
  it('reads the ticket parameter', () => {
    expect(ticketFromSearch('?ticket=WEB-101')).toBe('WEB-101');
    expect(ticketFromSearch('?status=live')).toBe(null);
    expect(ticketFromSearch('')).toBe(null);
  });

  it('adds the ticket parameter while preserving the existing filters', () => {
    expect(withTicketParam('?status=live&project=abc', 'WEB-101'))
      .toBe('?status=live&project=abc&ticket=WEB-101');
  });

  it('replaces rather than duplicating an existing ticket parameter', () => {
    expect(withTicketParam('?ticket=WEB-1', 'WEB-2')).toBe('?ticket=WEB-2');
  });

  it('removes only the ticket parameter on close', () => {
    expect(withoutTicketParam('?status=live&ticket=WEB-101')).toBe('?status=live');
  });

  it('returns an empty string when nothing is left, not a bare "?"', () => {
    expect(withoutTicketParam('?ticket=WEB-101')).toBe('');
  });
});
