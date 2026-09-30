import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '../enums.js';
import {
  canDragTicket,
  getBoardMoveBlockReason,
  getBoardMoveTargets,
} from '../board-permissions.js';

const actor = (role, id = 'u1') => ({ _id: id, role, roles: [role] });
const ticket = (status, over = {}) => ({
  status,
  assignedTo: 'dev-1',
  createdBy: 'reporter-1',
  ...over,
});

const clientCloseReopenCtx = {
  roleMatrix: {
    [ROLE_IDS.CLIENT]: ['tickets.accept'],
  },
  userOverrides: {},
  loadFailed: false,
};

test('an external client cannot drag without tickets.accept', () => {
  const client = actor(ROLE_IDS.CLIENT);
  assert.equal(canDragTicket(client, ticket('live')), false);
  assert.equal(canDragTicket(client, ticket('closed')), false);
  assert.equal(canDragTicket(client, ticket('pending')), false);
});

test('an external client can drag only live tickets when tickets.accept granted', () => {
  const client = actor(ROLE_IDS.CLIENT);
  assert.equal(canDragTicket(client, ticket('live'), undefined, clientCloseReopenCtx), true);
  assert.equal(canDragTicket(client, ticket('closed'), undefined, clientCloseReopenCtx), false);
  assert.equal(canDragTicket(client, ticket('pending'), undefined, clientCloseReopenCtx), false);
});

test('an external client can move live->closed, and cannot reopen, when granted', () => {
  const client = actor(ROLE_IDS.CLIENT);
  assert.equal(
    getBoardMoveBlockReason(client, ticket('live'), 'closed', undefined, clientCloseReopenCtx),
    null,
  );
  assert.equal(
    getBoardMoveBlockReason(client, ticket('closed'), 'in_progress', undefined, clientCloseReopenCtx).code,
    'CLIENT_BOARD_MOVE_FORBIDDEN',
  );
});

test('an external client is blocked from unsupported board moves when granted', () => {
  const client = actor(ROLE_IDS.CLIENT);
  const block = getBoardMoveBlockReason(
    client, ticket('closed'), 'ready_qa', undefined, clientCloseReopenCtx,
  );
  assert.equal(block.code, 'CLIENT_BOARD_MOVE_FORBIDDEN');
  assert.match(block.message, /only close Live tickets/);
});

test('getBoardMoveTargets marks current lane blocked and exposes allowed destinations', () => {
  const client = actor(ROLE_IDS.CLIENT);
  const targets = getBoardMoveTargets(client, ticket('live'), undefined, clientCloseReopenCtx);
  const intake = targets.find((t) => t.laneKey === 'intake');
  const done = targets.find((t) => t.laneKey === 'done');
  assert.equal(intake.blocked, true);
  assert.equal(done.blocked, false);
  assert.equal(done.to, 'closed');
});

test('a mixed internal+external actor follows internal board capabilities', () => {
  const hybrid = {
    _id: 'u-hybrid',
    role: ROLE_IDS.DEVELOPER,
    roles: [ROLE_IDS.DEVELOPER, ROLE_IDS.CLIENT],
  };
  assert.equal(canDragTicket(hybrid, ticket('in_progress')), true);
  assert.equal(
    getBoardMoveBlockReason(hybrid, ticket('in_progress'), 'ready_qa'),
    null,
  );
});
