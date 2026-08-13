import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_KEYS, canTransition } from '../stages.js';

/**
 * The gate table, transcribed INDEPENDENTLY from the design spec's §3 table
 * rather than imported from stages.js. That independence is the whole point:
 * two derivations of the same rule must agree, so editing stages.js without
 * intending to change behaviour fails here.
 */
const EXPECTED_GATES = {
  pending: { roles: [], relationships: [] },
  under_review: { roles: ['lead', 'admin'], relationships: [] },
  in_progress: { roles: ['lead', 'admin'], relationships: ['assignee'] },
  ready_local: { roles: ['admin'], relationships: ['assignee'] },
  ready_qa: { roles: ['admin'], relationships: ['assignee'] },
  deployed_staging: { roles: ['admin'], relationships: ['assignee'] },
  qa_approved: { roles: ['qa', 'admin'], relationships: [] },
  ready_production: { roles: ['lead', 'admin'], relationships: [] },
  live: { roles: ['admin'], relationships: [] },
  closed: { roles: ['lead', 'admin'], relationships: ['reporter'] },
};

const REOPEN = { roles: ['admin', 'lead', 'qa'], relationships: ['assignee'] };
const REOPEN_MIN = STAGE_KEYS.indexOf('ready_qa');

const ROLES = ['admin', 'lead', 'qa', 'developer', 'member'];
const RELATIONSHIPS = [
  { name: 'unrelated', assignee: false, reporter: false },
  { name: 'assignee', assignee: true, reporter: false },
  { name: 'reporter', assignee: false, reporter: true },
  { name: 'both', assignee: true, reporter: true },
];

function gatePasses(gate, role, rel) {
  if (gate.roles.includes(role)) return true;
  if (gate.relationships.includes('assignee') && rel.assignee) return true;
  if (gate.relationships.includes('reporter') && rel.reporter) return true;
  return false;
}

/** The rule, restated: forward is destination-gated; backward is Reopen only. */
function expectedOk(from, to, role, rel) {
  const fromIndex = STAGE_KEYS.indexOf(from);
  const toIndex = STAGE_KEYS.indexOf(to);

  if (fromIndex === toIndex) return false;
  if (toIndex < fromIndex) {
    if (to !== 'in_progress') return false;
    if (fromIndex < REOPEN_MIN) return false;
    return gatePasses(REOPEN, role, rel);
  }
  return gatePasses(EXPECTED_GATES[to], role, rel);
}

test('every (from, to) x role x relationship agrees with the spec table', () => {
  let checked = 0;
  const disagreements = [];

  for (const from of STAGE_KEYS) {
    for (const to of STAGE_KEYS) {
      for (const role of ROLES) {
        for (const rel of RELATIONSHIPS) {
          const actor = { _id: 'actor', role };
          const ticket = {
            assignedTo: rel.assignee ? 'actor' : 'someone-else',
            createdBy: rel.reporter ? 'actor' : 'someone-else',
          };

          const actual = canTransition(from, to, actor, ticket).ok;
          const expected = expectedOk(from, to, role, rel);
          checked += 1;

          if (actual !== expected) {
            disagreements.push(
              `${from} -> ${to} as ${role}/${rel.name}: got ${actual}, want ${expected}`,
            );
          }
        }
      }
    }
  }

  assert.equal(checked, 10 * 10 * 5 * 4, 'the matrix must be exhaustive');
  assert.deepEqual(disagreements, []);
});

test('no role can move a ticket backwards to anything but in_progress', () => {
  for (const from of STAGE_KEYS) {
    for (const to of STAGE_KEYS) {
      const backwards = STAGE_KEYS.indexOf(to) < STAGE_KEYS.indexOf(from);
      if (!backwards || to === 'in_progress') continue;

      for (const role of ROLES) {
        const result = canTransition(
          from, to, { _id: 'a', role }, { assignedTo: 'a', createdBy: 'a' },
        );
        assert.equal(result.ok, false, `${from} -> ${to} as ${role} must be illegal`);
      }
    }
  }
});

test('a member with no relationship to the ticket can move it nowhere', () => {
  for (const from of STAGE_KEYS) {
    for (const to of STAGE_KEYS) {
      const result = canTransition(
        from, to,
        { _id: 'nobody', role: 'member' },
        { assignedTo: 'dev', createdBy: 'reporter' },
      );
      assert.equal(result.ok, false, `${from} -> ${to} must be illegal for an unrelated member`);
    }
  }
});
