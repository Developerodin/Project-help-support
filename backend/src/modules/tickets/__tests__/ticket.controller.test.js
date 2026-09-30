import test from 'node:test';
import assert from 'node:assert/strict';
import { didEstimateFieldsChange } from '../ticket.controller.js';

test('estimate change detector returns false for no-op estimate patch', () => {
  const before = {
    estimatedResolutionAt: '2030-01-10T00:00:00.000Z',
    expectedReleaseDate: '2030-01-12T00:00:00.000Z',
  };
  const after = {
    estimatedResolutionAt: new Date('2030-01-10T00:00:00.000Z'),
    expectedReleaseDate: new Date('2030-01-12T00:00:00.000Z'),
  };

  assert.equal(didEstimateFieldsChange(before, after), false);
});

test('estimate change detector returns true when any estimate value changes', () => {
  const before = {
    estimatedResolutionAt: '2030-01-10T00:00:00.000Z',
    expectedReleaseDate: null,
  };
  const after = {
    estimatedResolutionAt: '2030-01-11T00:00:00.000Z',
    expectedReleaseDate: null,
  };

  assert.equal(didEstimateFieldsChange(before, after), true);
});
