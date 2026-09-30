import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ticketSearchClause,
  ticketSearchTermIsNoOp,
  TICKET_SEARCH_MAX_LENGTH,
} from '../ticket-search.js';

test('ticketSearchClause ignores punctuation-only terms', () => {
  assert.equal(ticketSearchClause('-'), null);
  assert.equal(ticketSearchTermIsNoOp(' - '), true);
});

test('ticketSearchClause still applies when a valid word remains', () => {
  assert.ok(ticketSearchClause('admin -'));
  assert.equal(ticketSearchTermIsNoOp('admin -'), false);
});

test('ticketSearchClause matches ticket id shapes', () => {
  assert.ok(ticketSearchClause('WEB-63'));
  assert.equal(ticketSearchTermIsNoOp('WEB-63'), false);
});

test('search max length matches API validation', () => {
  assert.equal(TICKET_SEARCH_MAX_LENGTH, 200);
});
