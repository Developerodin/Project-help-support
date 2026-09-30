import { describe, it, expect } from 'vitest';
import { ROLE_IDS } from '@pms/shared';
import { buildBoardRolePolicy, recordToBoardPolicy } from '@pms/shared';
import { canTransition } from '@pms/shared';

describe('ticket drawer footer visibility', () => {
  const ticket = {
    status: 'deployed_staging',
    revision: 1,
    createdBy: { id: 'other' },
    assignedTo: { id: 'other' },
  };

  it('hides QA approve forward action for developer', () => {
    const developer = { id: 'dev', role: ROLE_IDS.DEVELOPER, roles: [ROLE_IDS.DEVELOPER] };
    const policy = buildBoardRolePolicy();
    const forwardOk = canTransition('deployed_staging', 'qa_approved', developer, ticket, policy).ok;
    expect(forwardOk).toBe(false);
  });

  it('shows QA approve forward action for tester', () => {
    const tester = { id: 'qa', role: ROLE_IDS.TESTER, roles: [ROLE_IDS.TESTER] };
    const policy = buildBoardRolePolicy();
    const forwardOk = canTransition('deployed_staging', 'qa_approved', tester, ticket, policy).ok;
    expect(forwardOk).toBe(true);
  });

  it('respects custom policy denying qa_approve', () => {
    const tester = { id: 'qa', role: ROLE_IDS.TESTER, roles: [ROLE_IDS.TESTER] };
    const custom = recordToBoardPolicy({
      [ROLE_IDS.TESTER]: { qa: ['operate'] },
    });
    expect(canTransition('deployed_staging', 'qa_approved', tester, ticket, custom).ok).toBe(false);
  });
});
