import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RELEASE_BEFORE_RESOLUTION_MESSAGE,
  RESOLUTION_IN_PAST_MESSAGE,
  RELEASE_IN_PAST_MESSAGE,
  resolveTicketEstimateDates,
  ticketDateKey,
  todayDateKey,
  validateTicketEstimateDates,
} from '../ticket-dates.js';

test('ticketDateKey normalizes ISO datetimes and date-only strings', () => {
  assert.equal(ticketDateKey('2026-08-19'), '2026-08-19');
  assert.equal(ticketDateKey('2026-08-19T12:00:00.000Z'), '2026-08-19');
  assert.equal(ticketDateKey(new Date('2026-08-19T23:59:59.000Z')), '2026-08-19');
  assert.equal(ticketDateKey(null), null);
});

test('todayDateKey returns UTC date-only string', () => {
  assert.equal(todayDateKey(new Date('2026-08-19T23:59:59.000Z')), '2026-08-19');
});

test('validateTicketEstimateDates allows same-day and later release dates', () => {
  assert.equal(
    validateTicketEstimateDates('2026-08-19', '2026-08-19'),
    null,
  );
  assert.equal(
    validateTicketEstimateDates('2026-08-19', '2026-08-20'),
    null,
  );
});

test('validateTicketEstimateDates rejects release before resolution', () => {
  assert.deepEqual(
    validateTicketEstimateDates('2026-08-19', '2026-08-18'),
    { expectedReleaseDate: RELEASE_BEFORE_RESOLUTION_MESSAGE },
  );
});

test('validateTicketEstimateDates rejects past dates when field changed', () => {
  const today = '2026-08-20';

  assert.deepEqual(
    validateTicketEstimateDates('2026-08-18', null, {
      today,
      changedFields: ['estimatedResolutionAt'],
    }),
    { estimatedResolutionAt: RESOLUTION_IN_PAST_MESSAGE },
  );
  assert.deepEqual(
    validateTicketEstimateDates('2026-08-20', '2026-08-18', {
      today,
      changedFields: ['expectedReleaseDate'],
    }),
    { expectedReleaseDate: RELEASE_IN_PAST_MESSAGE },
  );
});

test('validateTicketEstimateDates allows existing past dates when not changed', () => {
  const today = '2026-08-20';

  assert.equal(
    validateTicketEstimateDates('2026-08-18', '2026-08-18', { today }),
    null,
  );
  assert.equal(
    validateTicketEstimateDates('2026-08-18', '2026-08-20', {
      today,
      changedFields: ['expectedReleaseDate'],
    }),
    null,
  );
});

test('validateTicketEstimateDates ignores partial date pairs', () => {
  assert.equal(validateTicketEstimateDates('2026-08-19', null), null);
  assert.equal(validateTicketEstimateDates(null, '2026-08-18'), null);
});

test('resolveTicketEstimateDates merges ticket values with a patch', () => {
  const ticket = {
    estimatedResolutionAt: '2026-08-19T00:00:00.000Z',
    expectedReleaseDate: '2026-08-20T00:00:00.000Z',
  };

  assert.deepEqual(
    resolveTicketEstimateDates(ticket, { expectedReleaseDate: '2026-08-21' }),
    {
      estimatedResolutionAt: '2026-08-19T00:00:00.000Z',
      expectedReleaseDate: '2026-08-21',
    },
  );

  assert.deepEqual(
    resolveTicketEstimateDates(ticket, { estimatedResolutionAt: null }),
    {
      estimatedResolutionAt: null,
      expectedReleaseDate: '2026-08-20T00:00:00.000Z',
    },
  );
});
