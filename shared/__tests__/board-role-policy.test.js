import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '../enums.js';
import {
  buildBoardRolePolicy,
  canBoardTransition,
  roleHasBoardCapability,
  resolveTransitionCapabilities,
  recordToBoardPolicy,
  boardPolicyToRecord,
  diffBoardPolicies,
} from '../board-role-policy.js';

const actor = (role, id = 'u1') => ({ _id: id, role, roles: [role] });
const ticket = (over = {}) => ({ createdBy: 'reporter', assignedTo: 'dev', ...over });
const policy = () => buildBoardRolePolicy();

test('resolveTransitionCapabilities maps QA approve and reject', () => {
  assert.deepEqual(
    resolveTransitionCapabilities('deployed_staging', 'qa_approved'),
    [{ board: 'qa', capability: 'qa_approve' }],
  );
  assert.deepEqual(
    resolveTransitionCapabilities('deployed_staging', 'in_progress'),
    [{ board: 'qa', capability: 'qa_reject' }],
  );
});

test('tester may QA approve; developer may not', () => {
  const p = policy();
  assert.equal(
    canBoardTransition('deployed_staging', 'qa_approved', actor(ROLE_IDS.TESTER), ticket(), p).ok,
    true,
  );
  assert.equal(
    canBoardTransition('deployed_staging', 'qa_approved', actor(ROLE_IDS.DEVELOPER), ticket(), p).ok,
    false,
  );
});

// Board rights are role-based: a developer works any Development ticket, assigned
// or not, but moving it out of Intake is a project admin's call.
test('developer may operate development without assignee relationship', () => {
  const unrelated = ticket({ createdBy: 'r', assignedTo: 'other' });
  assert.equal(
    canBoardTransition('in_progress', 'ready_local', actor(ROLE_IDS.DEVELOPER), unrelated, policy()).ok,
    true,
  );
  assert.equal(
    canBoardTransition('under_review', 'in_progress', actor(ROLE_IDS.DEVELOPER), unrelated, policy()).ok,
    false,
  );
});

test('read_only is denied by default on all boards', () => {
  const p = policy();
  assert.equal(roleHasBoardCapability(actor(ROLE_IDS.READ_ONLY), 'intake', 'operate', p), false);
  assert.equal(
    canBoardTransition('pending', 'under_review', actor(ROLE_IDS.READ_ONLY), ticket(), p).ok,
    false,
  );
});

test('admin may forward-skip across boards', () => {
  assert.equal(
    canBoardTransition('pending', 'live', actor(ROLE_IDS.ADMIN), ticket(), policy()).ok,
    true,
  );
});

test('custom policy grants tester only qa_approve on qa board', () => {
  const custom = recordToBoardPolicy({
    [ROLE_IDS.TESTER]: { qa: ['qa_approve'] },
  });
  assert.equal(
    canBoardTransition('deployed_staging', 'qa_approved', actor(ROLE_IDS.TESTER), ticket(), custom).ok,
    true,
  );
  assert.equal(
    canBoardTransition('deployed_staging', 'in_progress', actor(ROLE_IDS.TESTER), ticket(), custom).ok,
    false,
  );
});

test('diffBoardPolicies reports capability changes', () => {
  const from = policy();
  const to = buildBoardRolePolicy();
  to[ROLE_IDS.SUPPORT].intake = new Set(['operate']);
  const changes = diffBoardPolicies(from, to);
  assert.ok(changes.some((c) => c.role === ROLE_IDS.SUPPORT && c.capability === 'operate'));
});

test('pure external client cannot close without tickets.accept', () => {
  const p = policy();
  const external = actor(ROLE_IDS.CLIENT);
  const liveTicket = ticket({ status: 'live' });
  assert.equal(
    canBoardTransition('live', 'closed', external, liveTicket, p).ok,
    false,
  );
});

test('pure external client may close, but not reopen, when tickets.accept is granted', () => {
  const p = policy();
  const external = actor(ROLE_IDS.CLIENT);
  const liveTicket = ticket({ status: 'live' });
  const closedTicket = ticket({ status: 'closed' });
  const ctx = {
    roleMatrix: {
      [ROLE_IDS.CLIENT]: ['tickets.accept'],
    },
    userOverrides: {},
    loadFailed: false,
  };
  assert.equal(
    canBoardTransition('live', 'closed', external, liveTicket, p, ctx).ok,
    true,
  );
  assert.equal(
    canBoardTransition('closed', 'in_progress', external, closedTicket, p, ctx).ok,
    false,
  );
});

test('pure external client cannot move arbitrary stages even with tickets.accept', () => {
  const p = policy();
  const external = actor(ROLE_IDS.CLIENT);
  const ctx = {
    roleMatrix: {
      [ROLE_IDS.CLIENT]: ['tickets.accept'],
    },
    userOverrides: {},
    loadFailed: false,
  };
  assert.equal(
    canBoardTransition('pending', 'under_review', external, ticket(), p, ctx).ok,
    false,
  );
});

test('boardPolicyToRecord round-trips', () => {
  const p = policy();
  const record = boardPolicyToRecord(p);
  const restored = recordToBoardPolicy(record);
  assert.equal(
    roleHasBoardCapability(actor(ROLE_IDS.TESTER), 'qa', 'qa_reject', restored),
    true,
  );
});
