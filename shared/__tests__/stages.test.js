import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '../enums.js';
import {
  STAGES, STAGE_KEYS, stageIndex, stageLabel, LANES, laneOf,
  canTransition, legalDestinations, REOPEN_TARGET,
} from '../stages.js';

const actor = (role, id = 'u1') => ({ _id: id, role });
const ticket = (over = {}) => ({ createdBy: 'reporter', assignedTo: 'dev', ...over });

test('the ladder is ten stages in the documented order', () => {
  assert.deepEqual(STAGE_KEYS, [
    'pending', 'under_review', 'in_progress', 'ready_local', 'ready_qa',
    'deployed_staging', 'qa_approved', 'ready_production', 'live', 'closed',
  ]);
  assert.equal(STAGES.length, 10);
  STAGES.forEach((stage, i) => assert.equal(stage.index, i, `${stage.key} index`));
});

test('labels live beside the keys, so a rename is a one-line edit', () => {
  assert.equal(stageLabel('qa_approved'), 'Staging QA Approved');
  assert.equal(stageIndex('closed'), 9);
});

test('the five lanes cover every stage exactly once', () => {
  const covered = LANES.flatMap((lane) => lane.stages);
  assert.deepEqual([...covered].sort(), [...STAGE_KEYS].sort());
  assert.equal(covered.length, STAGE_KEYS.length);
  assert.equal(laneOf('deployed_staging'), 'qa');
});

test('a forward skip is legal when the destination gate passes', () => {
  assert.equal(canTransition('pending', 'live', actor('admin'), ticket()).ok, true);
});

test('the same skip is refused for a developer', () => {
  const result = canTransition('pending', 'live', actor('developer'), ticket());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STAGE_NOT_PERMITTED');
  assert.match(result.reason, /Live/);
});

test('gates are role-based — developer may move Development work without assignee relationship', () => {
  const stranger = actor(ROLE_IDS.DEVELOPER, 'nobody');
  assert.equal(canTransition('in_progress', 'ready_local', stranger, ticket()).ok, true);

  const readOnly = actor(ROLE_IDS.READ_ONLY, 'nobody');
  assert.equal(canTransition('in_progress', 'ready_local', readOnly, ticket()).ok, false);
});

test('a developer cannot approve QA and a qa cannot ship to live', () => {
  assert.equal(
    canTransition('deployed_staging', 'qa_approved', actor('developer', 'dev'), ticket()).ok,
    false,
  );
  assert.equal(canTransition('ready_production', 'live', actor('qa'), ticket()).ok, false);
});

test('a move to the same stage is refused rather than silently accepted', () => {
  const result = canTransition('in_progress', 'in_progress', actor('admin'), ticket());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'SAME_STAGE');
});

test('below admin, the only legal backward move is a Reopen to in_progress', () => {
  const ok = canTransition('qa_approved', REOPEN_TARGET, actor('qa'), ticket());
  assert.equal(ok.ok, true);
  assert.equal(ok.isReopen, true);

  const wrongTarget = canTransition('live', 'ready_local', actor('project_admin'), ticket());
  assert.equal(wrongTarget.ok, false);
  assert.equal(wrongTarget.code, 'ILLEGAL_BACKWARD');
});

test('below admin, Reopen is unavailable before ready_qa', () => {
  const result = canTransition('ready_local', 'in_progress', actor('project_admin'), ticket());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'REOPEN_TOO_EARLY');
});

test('admins and super admins may move any ticket to any stage; backward still counts as a reopen', () => {
  for (const role of ['admin', 'super_admin']) {
    const back = canTransition('live', 'ready_local', actor(role), ticket());
    assert.equal(back.ok, true, role);
    assert.equal(back.isReopen, true, role);
    assert.equal(canTransition('ready_local', 'in_progress', actor(role), ticket()).ok, true, role);
    assert.equal(canTransition('pending', 'closed', actor(role), ticket()).isClose, true, role);
  }
});

test('a qa user can Reopen — otherwise rejecting a build is impossible', () => {
  // Destination gating alone would block this: in_progress is gated on
  // lead/admin/assignee, and `qa` is none of those.
  const result = canTransition('deployed_staging', 'in_progress', actor('qa'), ticket());
  assert.equal(result.ok, true);
  assert.equal(result.isReopen, true);
});

test('a Reopen out of a QA-lane stage carries decision "rejected"', () => {
  assert.equal(
    canTransition('deployed_staging', 'in_progress', actor('qa'), ticket()).decision,
    'rejected',
  );
  // Reopening a shipped or closed ticket is not a QA rejection.
  assert.equal(canTransition('live', 'in_progress', actor('admin'), ticket()).decision, null);
});

test('entering qa_approved carries decision "approved"', () => {
  assert.equal(
    canTransition('deployed_staging', 'qa_approved', actor('qa'), ticket()).decision,
    'approved',
  );
});

test('a developer may close and reopen via done-board operate capability', () => {
  const dev = actor(ROLE_IDS.DEVELOPER, 'dev-1');
  const unrelated = ticket({ createdBy: 'reporter', assignedTo: 'someone-else' });
  const closeResult = canTransition('in_progress', 'closed', dev, unrelated);
  assert.equal(closeResult.ok, true);
  assert.equal(closeResult.isClose, true);

  const reopenResult = canTransition('closed', 'in_progress', dev, unrelated);
  assert.equal(reopenResult.ok, true);
  assert.equal(reopenResult.isReopen, true);
});

test('an admin may close and reopen', () => {
  const closeResult = canTransition('under_review', 'closed', actor('admin'), ticket());
  assert.equal(closeResult.ok, true);
  assert.equal(closeResult.isClose, true);

  const reopenResult = canTransition('closed', 'in_progress', actor('admin'), ticket());
  assert.equal(reopenResult.ok, true);
  assert.equal(reopenResult.isReopen, true);
});

const clientCloseReopenCtx = {
  roleMatrix: {
    client: ['tickets.accept'],
  },
  userOverrides: {},
  loadFailed: false,
};

test('a client cannot close a Live ticket without tickets.accept', () => {
  const result = canTransition('live', 'closed', actor('client'), ticket());
  assert.equal(result.ok, false);
});

test('a client may close a Live ticket when tickets.accept is granted', () => {
  const result = canTransition(
    'live', 'closed', actor('client'), ticket(), undefined, clientCloseReopenCtx,
  );
  assert.equal(result.ok, true);
  assert.equal(result.isClose, true);
});

test('a client may not reopen a closed ticket, even with tickets.accept', () => {
  const result = canTransition(
    'closed', 'in_progress', actor('client'), ticket(), undefined, clientCloseReopenCtx,
  );
  assert.equal(result.ok, false);
});

test('a client may not move tickets except Live to Closed', () => {
  const client = actor('client');
  assert.equal(
    canTransition('pending', 'closed', client, ticket(), undefined, clientCloseReopenCtx).ok,
    false,
  );
  assert.equal(
    canTransition('closed', 'ready_qa', client, ticket(), undefined, clientCloseReopenCtx).ok,
    false,
  );
  assert.equal(
    canTransition('live', 'ready_production', client, ticket(), undefined, clientCloseReopenCtx).ok,
    false,
  );
  assert.match(
    canTransition('pending', 'closed', client, ticket(), undefined, clientCloseReopenCtx).reason,
    /only move Live tickets to Closed$/,
  );
});

test('unassigned role cannot close or reopen', () => {
  const unrelated = ticket({ createdBy: 'reporter', assignedTo: 'someone-else' });
  assert.equal(canTransition('in_progress', 'closed', actor(ROLE_IDS.UNASSIGNED, 'm-1'), unrelated).ok, false);
  assert.equal(canTransition('closed', 'in_progress', actor(ROLE_IDS.UNASSIGNED, 'm-1'), unrelated).ok, false);
});

test('legalDestinations returns exactly what the client should render', () => {
  const destinations = legalDestinations('pending', actor('admin'), ticket());

  assert.ok(destinations.includes('under_review'));
  assert.ok(destinations.includes('live'));
  assert.ok(!destinations.includes('pending'));
  // Reopen is unavailable from pending, so everything offered is forward.
  assert.ok(destinations.every((key) => stageIndex(key) > stageIndex('pending')));
});

test('unknown stage keys are refused, never coerced', () => {
  assert.equal(canTransition('pending', 'Resolved', actor('admin'), ticket()).code, 'UNKNOWN_STAGE');
  assert.equal(canTransition('Open', 'live', actor('admin'), ticket()).code, 'UNKNOWN_STAGE');
});

test('a mixed internal+external actor retains full admin transitions — the external branch is skipped', () => {
  // A user holding both an internal and an external role is not "external" for
  // stage-gating purposes: the internal role must win, not the client carve-out.
  const mixed = { _id: 'u1', roles: ['admin', 'client'] };
  const forward = canTransition('pending', 'live', mixed, ticket());
  assert.equal(forward.ok, true);
  assert.equal(forward.isClose, false);

  const nonLiveClose = canTransition('pending', 'closed', mixed, ticket());
  assert.equal(nonLiveClose.ok, true);
});

test('a client-only actor is confined to closing Live tickets when granted', () => {
  const client = { _id: 'u1', roles: ['client'] };
  const blocked = canTransition(
    'pending', 'live', client, ticket(), undefined, clientCloseReopenCtx,
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'STAGE_NOT_PERMITTED');

  const closeAllowed = canTransition(
    'live', 'closed', client, ticket(), undefined, clientCloseReopenCtx,
  );
  assert.equal(closeAllowed.ok, true);
  assert.equal(closeAllowed.isClose, true);

  const reopen = canTransition(
    'closed', 'in_progress', client, ticket(), undefined, clientCloseReopenCtx,
  );
  assert.equal(reopen.ok, false);
});

test('STAGE_ROLE_ALIASES: super_admin passes an admin-gated transition', () => {
  const result = canTransition('ready_production', 'live', actor('super_admin'), ticket());
  assert.equal(result.ok, true);
});

test('STAGE_ROLE_ALIASES: project_admin passes a lead-gated transition', () => {
  const result = canTransition('pending', 'under_review', actor('project_admin'), ticket());
  assert.equal(result.ok, true);
});

test('STAGE_ROLE_ALIASES: tester passes a qa-gated transition', () => {
  const result = canTransition('deployed_staging', 'qa_approved', actor(ROLE_IDS.TESTER), ticket());
  assert.equal(result.ok, true);
});

test('legacy qa alias passes a qa-gated transition', () => {
  const result = canTransition('deployed_staging', 'qa_approved', actor('qa'), ticket());
  assert.equal(result.ok, true);
});

test('STAGE_ROLE_ALIASES: a plain developer does NOT pass a qa-gated transition', () => {
  const result = canTransition('deployed_staging', 'qa_approved', actor(ROLE_IDS.DEVELOPER), ticket());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'STAGE_NOT_PERMITTED');
});
