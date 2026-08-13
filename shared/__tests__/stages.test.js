import test from 'node:test';
import assert from 'node:assert/strict';
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

test('gates are role OR relationship — the assignee may start work', () => {
  const assignee = actor('developer', 'dev');
  assert.equal(canTransition('under_review', 'in_progress', assignee, ticket()).ok, true);

  const stranger = actor('developer', 'nobody');
  assert.equal(canTransition('under_review', 'in_progress', stranger, ticket()).ok, false);
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

test('the only legal backward move is a Reopen to in_progress', () => {
  const ok = canTransition('qa_approved', REOPEN_TARGET, actor('qa'), ticket());
  assert.equal(ok.ok, true);
  assert.equal(ok.isReopen, true);

  const wrongTarget = canTransition('live', 'ready_local', actor('admin'), ticket());
  assert.equal(wrongTarget.ok, false);
  assert.equal(wrongTarget.code, 'ILLEGAL_BACKWARD');
});

test('Reopen is unavailable before ready_qa', () => {
  const result = canTransition('ready_local', 'in_progress', actor('admin'), ticket());
  assert.equal(result.ok, false);
  assert.equal(result.code, 'REOPEN_TOO_EARLY');
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

test('the reporter may close their own ticket early', () => {
  const result = canTransition('in_progress', 'closed', actor('member', 'reporter'), ticket());
  assert.equal(result.ok, true);
  assert.equal(result.isClose, true);
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
