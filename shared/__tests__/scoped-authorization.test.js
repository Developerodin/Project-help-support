import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canInScope, anyScopedAssignmentGrants } from '../scoped-authorization.js';
import { ROLE_IDS } from '../enums.js';

const baseUser = { roles: [ROLE_IDS.DEVELOPER] };

describe('canInScope', () => {
  it('denies empty scope when assignments are project-scoped', () => {
    const scopedAssignments = [{
      status: 'active',
      role: ROLE_IDS.TESTER,
      clientId: 'c1',
      projectId: 'p1',
      environments: [],
    }];
    const allowed = canInScope(baseUser, 'tickets.view', {}, {
      scopedAssignments,
      roleMatrix: null,
    });
    assert.equal(allowed, false);
  });

  it('allows empty scope for environment-only global assignments', () => {
    const scopedAssignments = [{
      status: 'active',
      role: ROLE_IDS.TESTER,
      clientId: null,
      projectId: null,
      environments: ['Staging'],
    }];
    const allowed = canInScope(baseUser, 'tickets.view', {}, {
      scopedAssignments,
      roleMatrix: null,
    });
    assert.equal(allowed, true);
  });
});

describe('anyScopedAssignmentGrants', () => {
  it('returns true when an active assignment role grants the permission', () => {
    const ok = anyScopedAssignmentGrants('tickets.view', {
      scopedAssignments: [{
        status: 'active',
        role: ROLE_IDS.TESTER,
        projectId: 'p1',
        clientId: 'c1',
      }],
    });
    assert.equal(ok, true);
  });
});
