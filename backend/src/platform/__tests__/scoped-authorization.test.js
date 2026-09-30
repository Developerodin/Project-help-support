import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_IDS,
  assignmentCoversScope,
  canDelegateRole,
  canImpersonateUser,
  canInScope,
  environmentGrantsAccess,
  validateDelegation,
  validateImpersonation,
} from '@pms/shared';

const projectAdmin = { roles: [ROLE_IDS.PROJECT_ADMIN] };
const developer = { roles: [ROLE_IDS.DEVELOPER] };
const admin = { roles: [ROLE_IDS.ADMIN] };

test('canDelegateRole enforces seniority and blocks super admin delegation', () => {
  assert.equal(canDelegateRole(admin, ROLE_IDS.DEVELOPER), true);
  assert.equal(canDelegateRole(developer, ROLE_IDS.ADMIN), false);
  assert.equal(canDelegateRole(admin, ROLE_IDS.SUPER_ADMIN), false);
});

test('validateDelegation blocks self-escalation', () => {
  const actor = { _id: 'actor-1', roles: [ROLE_IDS.ADMIN] };
  const result = validateDelegation(actor, ROLE_IDS.DEVELOPER, { targetUserId: 'user-1' });
  assert.equal(result.allowed, true);

  const self = validateDelegation(actor, ROLE_IDS.DEVELOPER, { targetUserId: 'actor-1' });
  assert.equal(self.allowed, false);
  assert.equal(self.code, 'CANNOT_DELEGATE_SELF');
});

test('validateImpersonation enforces initiator roles and multi-role hierarchy', () => {
  const superAdmin = { _id: 'sa', roles: [ROLE_IDS.SUPER_ADMIN] };
  const admin = { _id: 'admin', roles: [ROLE_IDS.ADMIN] };
  const peerAdmin = { _id: 'peer', roles: [ROLE_IDS.ADMIN, ROLE_IDS.DEVELOPER] };
  const developer = { _id: 'dev', roles: [ROLE_IDS.DEVELOPER] };
  const projectAdmin = { _id: 'pa', roles: [ROLE_IDS.PROJECT_ADMIN] };
  const client = { _id: 'client', roles: [ROLE_IDS.CLIENT] };
  const multiInitiator = { _id: 'mi', roles: [ROLE_IDS.PROJECT_ADMIN, ROLE_IDS.DEVELOPER] };

  assert.equal(validateImpersonation(admin, developer).allowed, true);
  assert.equal(canImpersonateUser(superAdmin, admin), true);
  assert.equal(validateImpersonation(admin, peerAdmin).code, 'CANNOT_IMPERSONATE_PEER');
  assert.equal(validateImpersonation(admin, projectAdmin).allowed, true);
  assert.equal(validateImpersonation(superAdmin, { _id: 'sa2', roles: [ROLE_IDS.SUPER_ADMIN] }).code, 'SUPER_ADMIN_PROTECTED');
  assert.equal(validateImpersonation(admin, client).allowed, true);
  assert.equal(validateImpersonation(multiInitiator, developer).code, 'NOT_IMPERSONATION_INITIATOR');
  assert.equal(validateImpersonation(admin, admin).code, 'CANNOT_IMPERSONATE_SELF');
  assert.equal(validateImpersonation(admin, { _id: 'high', roles: [ROLE_IDS.ADMIN] }).code, 'CANNOT_IMPERSONATE_PEER');
});

test('assignmentCoversScope respects client, project, and environment dimensions', () => {
  const assignment = {
    status: 'active',
    client: 'client-1',
    project: 'project-1',
    environments: ['Staging'],
    role: ROLE_IDS.PROJECT_ADMIN,
  };

  assert.equal(
    assignmentCoversScope(assignment, { clientId: 'client-1', projectId: 'project-1', environment: 'Staging' }),
    true,
  );
  assert.equal(
    assignmentCoversScope(assignment, { clientId: 'client-1', projectId: 'project-1', environment: 'Production' }),
    false,
  );
  assert.equal(
    assignmentCoversScope(assignment, { clientId: 'client-1', projectId: 'project-2' }),
    false,
  );
});

test('environmentGrantsAccess treats empty environments as no environment axis', () => {
  assert.equal(environmentGrantsAccess([], null), true);
  assert.equal(environmentGrantsAccess([], 'Staging'), false);
  assert.equal(environmentGrantsAccess(['Staging'], 'Staging'), true);
});

test('canInScope combines global grants with scoped constraints', () => {
  const scopedAssignments = [{
    status: 'active',
    client: 'client-1',
    project: 'project-1',
    environments: ['Staging'],
    role: ROLE_IDS.PROJECT_ADMIN,
  }];

  assert.equal(
    canInScope(projectAdmin, 'projects.manage', { clientId: 'client-1', projectId: 'project-1' }, { scopedAssignments }),
    true,
  );
  assert.equal(
    canInScope(projectAdmin, 'projects.manage', { clientId: 'client-2', projectId: 'project-9' }, { scopedAssignments }),
    false,
  );
  assert.equal(
    canInScope(developer, 'projects.manage', { clientId: 'client-1', projectId: 'project-1' }, { scopedAssignments }),
    false,
  );
});

test('canInScope preserves global-only behaviour when no scoped assignments exist', () => {
  assert.equal(
    canInScope(developer, 'tickets.create', { clientId: 'client-1', projectId: 'project-1' }, { scopedAssignments: [] }),
    true,
  );
});

test('canInScope honours clientId/projectId assignment shape from permission context', () => {
  const scopedAssignments = [{
    status: 'active',
    clientId: 'client-1',
    projectId: 'project-1',
    environments: ['Staging'],
    role: ROLE_IDS.PROJECT_ADMIN,
  }];

  assert.equal(
    canInScope(projectAdmin, 'projects.manage', { clientId: 'client-1', projectId: 'project-1' }, { scopedAssignments }),
    true,
  );
  assert.equal(
    canInScope(projectAdmin, 'projects.manage', { clientId: 'client-2', projectId: 'project-9' }, { scopedAssignments }),
    false,
  );
});

test('serialized scoped assignments are not treated as global', () => {
  const scopedAssignments = [{
    status: 'active',
    clientId: 'client-1',
    projectId: 'project-1',
    environments: ['Staging'],
    role: ROLE_IDS.PROJECT_ADMIN,
  }];

  assert.equal(
    canInScope(projectAdmin, 'projects.manage', { clientId: 'other-client' }, { scopedAssignments }),
    false,
  );
});

test('canInScope denies when all scoped assignments are expired', () => {
  const scopedAssignments = [{
    status: 'active',
    clientId: 'client-1',
    projectId: 'project-1',
    environments: ['Staging'],
    role: ROLE_IDS.PROJECT_ADMIN,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  }];

  assert.equal(
    canInScope(projectAdmin, 'projects.manage', { clientId: 'client-1', projectId: 'project-1' }, { scopedAssignments }),
    false,
  );
});

test('canInScope denies expired scoped assignments', () => {
  const scopedAssignments = [{
    status: 'active',
    clientId: 'client-1',
    projectId: 'project-1',
    environments: ['Staging'],
    role: ROLE_IDS.PROJECT_ADMIN,
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  }];

  assert.equal(
    canInScope(projectAdmin, 'projects.manage', { clientId: 'client-1', projectId: 'project-1' }, { scopedAssignments }),
    false,
  );
});

test('canInScope fails closed on invalid environment values', () => {
  const scopedAssignments = [{
    status: 'active',
    clientId: 'client-1',
    projectId: 'project-1',
    environments: ['Staging'],
    role: ROLE_IDS.PROJECT_ADMIN,
  }];

  assert.equal(
    canInScope(
      projectAdmin,
      'projects.manage',
      { clientId: 'client-1', projectId: 'project-1', environment: 'NotARealEnv' },
      { scopedAssignments },
    ),
    false,
  );
});

test('assignmentCoversScope denies expired assignments', () => {
  const assignment = {
    status: 'active',
    clientId: 'client-1',
    projectId: 'project-1',
    environments: ['Staging'],
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  };

  assert.equal(
    assignmentCoversScope(assignment, { clientId: 'client-1', projectId: 'project-1', environment: 'Staging' }),
    false,
  );
});

test('client-wide assignment covers project scope when clientId is provided', () => {
  const assignment = {
    status: 'active',
    clientId: 'client-1',
    projectId: null,
    environments: ['Staging'],
    role: ROLE_IDS.PROJECT_ADMIN,
  };

  assert.equal(
    assignmentCoversScope(assignment, { clientId: 'client-1', projectId: 'project-1', environment: 'Staging' }),
    true,
  );
  assert.equal(
    assignmentCoversScope(assignment, { projectId: 'project-1', environment: 'Staging' }),
    false,
  );
});

test('canInScope honours client-wide scoped inheritance', () => {
  const scopedAssignments = [{
    status: 'active',
    clientId: 'client-1',
    projectId: null,
    environments: ['Staging'],
    role: ROLE_IDS.PROJECT_ADMIN,
  }];

  assert.equal(
    canInScope(projectAdmin, 'projects.manage', { clientId: 'client-1', projectId: 'project-1' }, { scopedAssignments }),
    true,
  );
  assert.equal(
    canInScope(projectAdmin, 'projects.manage', { projectId: 'project-1' }, { scopedAssignments }),
    false,
  );
});
