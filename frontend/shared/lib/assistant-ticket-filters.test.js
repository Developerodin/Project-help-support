import { describe, expect, it, vi } from 'vitest';
import {
  ASSISTANT_TICKET_FILTERS_EVENT, nextTicketFilters, requestTicketFilters, takeTicketFilters,
} from './assistant-ticket-filters.js';

const onScreen = {
  q: '', status: 'pending', priority: 'High', category: '', severity: '', scope: 'all', assignedTo: '',
  blocked: false, overdue: false, reopened: false, newReply: false,
};

describe('assistant ticket filters', () => {
  it('"any stage" clears only the stage and keeps the rest of the saved view', () => {
    expect(nextTicketFilters(onScreen, { filters: { status: '' } })).toEqual({ ...onScreen, status: '' });
  });

  it('clear_all starts from no filters; an owner is matched by name in the owner list', () => {
    const owners = [{ id: 'u1', name: 'Riya Sharma' }, { id: 'u2', name: 'Harsh Bansal' }];
    const next = nextTicketFilters(onScreen, { reset: true, filters: { overdue: true }, ownerName: 'riya' }, owners);
    expect(next).toMatchObject({ status: '', priority: '', overdue: true, assignedTo: 'u1' });
    expect(nextTicketFilters(onScreen, { filters: {}, ownerName: 'Nobody' }, owners).assignedTo).toBe('');
  });

  it('a request waits for the page, and is taken only once', () => {
    const heard = vi.fn();
    window.addEventListener(ASSISTANT_TICKET_FILTERS_EVENT, heard);
    requestTicketFilters({ filters: { status: '' } });
    expect(heard).toHaveBeenCalledOnce();
    expect(takeTicketFilters()).toEqual({ filters: { status: '' } });
    expect(takeTicketFilters()).toBeNull();
    window.removeEventListener(ASSISTANT_TICKET_FILTERS_EVENT, heard);
  });
});
