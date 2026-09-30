import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '../enums.js';
import { STAGE_KEYS, canTransition } from '../stages.js';
import {
  buildBoardRolePolicy,
  canBoardTransition,
} from '../board-role-policy.js';

const actor = (role, id = 'u1') => ({ _id: id, role, roles: [role] });
const ticket = (over = {}) => ({ createdBy: 'reporter', assignedTo: 'dev', ...over });
const policy = () => buildBoardRolePolicy();

test('canTransition delegates to board-role policy', () => {
  const p = policy();
  const from = 'deployed_staging';
  const to = 'qa_approved';
  const a = actor(ROLE_IDS.TESTER);
  const t = ticket();

  assert.deepEqual(canTransition(from, to, a, t, p), canBoardTransition(from, to, a, t, p));
});

test('tester may QA approve; developer may not', () => {
  const p = policy();
  assert.equal(
    canTransition('deployed_staging', 'qa_approved', actor(ROLE_IDS.TESTER), ticket(), p).ok,
    true,
  );
  assert.equal(
    canTransition('deployed_staging', 'qa_approved', actor(ROLE_IDS.DEVELOPER), ticket(), p).ok,
    false,
  );
});

// Board rights are role-based: a developer works any Development ticket, assigned
// or not, but moving it out of Intake is a project admin's call.
test('developer may operate development without assignee relationship', () => {
  const unrelated = ticket({ createdBy: 'r', assignedTo: 'other' });
  assert.equal(
    canTransition('in_progress', 'ready_local', actor(ROLE_IDS.DEVELOPER), unrelated, policy()).ok,
    true,
  );
  assert.equal(
    canTransition('under_review', 'in_progress', actor(ROLE_IDS.DEVELOPER), unrelated, policy()).ok,
    false,
  );
});

test('read_only is denied by default on all boards', () => {
  const p = policy();
  assert.equal(
    canTransition('pending', 'under_review', actor(ROLE_IDS.READ_ONLY), ticket(), p).ok,
    false,
  );
});

test('admin may forward-skip across boards', () => {
  assert.equal(
    canTransition('pending', 'live', actor(ROLE_IDS.ADMIN), ticket(), policy()).ok,
    true,
  );
});

test('below admin, no role can move a ticket backwards to anything but in_progress', () => {
  for (const from of STAGE_KEYS) {
    for (const to of STAGE_KEYS) {
      const backwards = STAGE_KEYS.indexOf(to) < STAGE_KEYS.indexOf(from);
      if (!backwards || to === 'in_progress') continue;

      // Admins are the exception: they may move any ticket to any stage.
      for (const role of [ROLE_IDS.PROJECT_ADMIN, ROLE_IDS.DEVELOPER, ROLE_IDS.TESTER]) {
        const result = canTransition(
          from, to, actor(role), ticket({ assignedTo: 'a', createdBy: 'a' }), policy(),
        );
        assert.equal(result.ok, false, `${from} -> ${to} as ${role} must be illegal`);
      }
    }
  }
});

test('unassigned role cannot transition tickets', () => {
  for (const from of STAGE_KEYS) {
    for (const to of STAGE_KEYS) {
      if (from === to) continue;
      const result = canTransition(
        from, to,
        actor(ROLE_IDS.UNASSIGNED),
        ticket({ assignedTo: 'dev', createdBy: 'reporter' }),
        policy(),
      );
      assert.equal(result.ok, false, `${from} -> ${to} must be illegal for unassigned`);
    }
  }
});
