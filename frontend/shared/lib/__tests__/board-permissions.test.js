import { describe, it, expect } from 'vitest';
import { ROLE_IDS } from '@pms/shared';
import {
  describeStagePermittees,
  canInteractWithBoard,
  canDragTicket,
  getBoardMoveBlockReason,
  getBoardReadOnlyNotice,
  getBoardDragBlockReason,
} from '@pms/shared';

const actor = (role, id = 'user-1') => ({ id, role, roles: [role] });

const ticket = (over = {}) => ({
  ticketId: 'WEB-1',
  status: 'under_review',
  createdBy: { _id: 'reporter-1' },
  assignedTo: null,
  ...over,
});

const clientAcceptCtx = {
  roleMatrix: { [ROLE_IDS.CLIENT]: ['tickets.accept'] },
  userOverrides: {},
  loadFailed: false,
};

describe('board-permissions', () => {
  it('describes stage permittees from board-role policy', () => {
    expect(describeStagePermittees('qa_approved')).toMatch(/Tester|Admin/);
    expect(describeStagePermittees('in_progress')).toMatch(/Developer|Project Admin|Admin/);
  });

  it('lets clients with tickets.accept interact with the board without a persistent read-only notice', () => {
    const client = actor(ROLE_IDS.CLIENT);
    expect(canInteractWithBoard(client)).toBe(false);
    expect(canInteractWithBoard(client, undefined, clientAcceptCtx)).toBe(true);
    expect(getBoardReadOnlyNotice(client)).toBeNull();
  });

  it('allows clients with tickets.accept to drag only Live tickets', () => {
    const client = actor(ROLE_IDS.CLIENT);
    expect(canDragTicket(client, ticket({ status: 'live' }))).toBe(false);
    expect(canDragTicket(client, ticket({ status: 'live' }), undefined, clientAcceptCtx)).toBe(true);
    expect(canDragTicket(client, ticket({ status: 'pending' }), undefined, clientAcceptCtx)).toBe(false);
  });

  it('blocks read-only internal users without board capabilities', () => {
    const readOnly = actor(ROLE_IDS.READ_ONLY);
    expect(canInteractWithBoard(readOnly)).toBe(false);
    expect(getBoardReadOnlyNotice(readOnly)?.code).toBe('NO_BOARD_PERMISSION');
  });

  it('allows developers to drag tickets in development without assignee relationship', () => {
    const developer = actor(ROLE_IDS.DEVELOPER);
    const unassigned = ticket({ status: 'in_progress', assignedTo: null });

    expect(canDragTicket(developer, unassigned)).toBe(true);
    expect(getBoardMoveBlockReason(developer, unassigned, 'ready_local')).toBeNull();
  });

  it('blocks developers from QA approve moves', () => {
    const developer = actor(ROLE_IDS.DEVELOPER);
    const inQa = ticket({ status: 'deployed_staging' });

    const block = getBoardMoveBlockReason(developer, inQa, 'qa_approved');
    expect(block?.code).toBe('STAGE_NOT_PERMITTED');
    expect(block?.message).toMatch(/QA approve/i);
  });

  it('blocks support users without board capabilities from dragging', () => {
    const support = actor(ROLE_IDS.SUPPORT);
    expect(getBoardDragBlockReason(support, ticket())?.code).toBe('NO_BOARD_PERMISSION');
  });
});
