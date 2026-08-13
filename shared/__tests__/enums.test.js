import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES, SEVERITIES, PRIORITIES, CATEGORIES, LABELS, LINK_RELS, STAGE_DECISIONS,
} from '../enums.js';

const ALL = { ROLES, SEVERITIES, PRIORITIES, CATEGORIES, LABELS, LINK_RELS, STAGE_DECISIONS };

test('every enum is a frozen array of unique non-empty strings', () => {
  for (const [name, values] of Object.entries(ALL)) {
    assert.ok(Array.isArray(values), `${name} should be an array`);
    assert.ok(Object.isFrozen(values), `${name} should be frozen`);
    assert.ok(values.length > 0, `${name} should not be empty`);
    assert.equal(new Set(values).size, values.length, `${name} has duplicates`);
    for (const v of values) {
      assert.equal(typeof v, 'string', `${name} contains a non-string`);
      assert.ok(v.trim().length > 0, `${name} contains an empty string`);
    }
  }
});

test('stage decisions cover only the QA verdicts', () => {
  assert.deepEqual([...STAGE_DECISIONS], ['approved', 'rejected']);
});

test('roles are listed most to least privileged for display', () => {
  assert.deepEqual([...ROLES], ['admin', 'lead', 'qa', 'developer', 'member']);
});
