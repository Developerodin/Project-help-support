import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ticketSearchClause } from './ticket.service.js';

describe('ticketSearchClause', () => {
  it('ignores single-character word tokens to limit regex scan breadth', () => {
    assert.equal(ticketSearchClause('a'), null);
    const clause = ticketSearchClause('a bug');
    assert.ok(clause?.$and);
    assert.equal(clause.$and.length, 1);
  });
});
