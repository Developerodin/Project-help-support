import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeTicketFilterLabels,
  cycleTicketSort,
  defaultTicketPreferencesForUser,
  EXTERNAL_DEFAULT_TICKET_FILTER_STATUS,
  hasTicketPreferenceChanges,
} from '../ticket-preferences.js';
import { ROLE_IDS } from '../enums.js';

describe('cycleTicketSort', () => {
  it('starts a new column at descending', () => {
    assert.deepEqual(cycleTicketSort({ column: 'ticketId', direction: 'desc' }, 'title'), { column: 'title', direction: 'desc' });
  });

  it('cycles desc to asc and back to desc on the same column', () => {
    const desc = { column: 'inStage', direction: 'desc' };
    const asc = cycleTicketSort(desc, 'inStage');
    assert.deepEqual(asc, { column: 'inStage', direction: 'asc' });
    assert.deepEqual(cycleTicketSort(asc, 'inStage'), { column: 'inStage', direction: 'desc' });
  });
});

describe('activeTicketFilterLabels', () => {
  it('names active filters for empty states', () => {
    assert.deepEqual(activeTicketFilterLabels({
      q: 'admin',
      priority: 'Urgent',
      blocked: true,
    }), ['Search: admin', 'Priority: Urgent', 'Blocked']);
  });
});

describe('hasTicketPreferenceChanges', () => {
  it('detects a non-default page size', () => {
    assert.equal(hasTicketPreferenceChanges({ limit: 50 }, { roles: ['admin'] }), true);
  });
});

describe('defaultTicketPreferencesForUser', () => {
  it('defaults external users to the under-review stage filter', () => {
    const prefs = defaultTicketPreferencesForUser({ roles: [ROLE_IDS.CLIENT] });
    assert.equal(prefs.filters.status, EXTERNAL_DEFAULT_TICKET_FILTER_STATUS);
  });

  it('leaves internal users on the open default filters', () => {
    const prefs = defaultTicketPreferencesForUser({ roles: [ROLE_IDS.DEVELOPER] });
    assert.equal(prefs.filters.status, '');
  });
});
