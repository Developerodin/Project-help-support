import { describe, it, expect } from 'vitest';
import { ROLE_IDS, mergeRoleMatrixWithBaseline } from '@pms/shared';
import { canAccessRoute, getDefaultRedirect } from '../route-permissions.js';

const admin = { roles: [ROLE_IDS.ADMIN] };
const developer = { roles: [ROLE_IDS.DEVELOPER] };
const unassigned = { roles: [ROLE_IDS.UNASSIGNED] };
const readOnly = { roles: [ROLE_IDS.READ_ONLY] };
const client = { roles: [ROLE_IDS.CLIENT] };
const clientTester = { roles: [ROLE_IDS.CLIENT_TESTER] };

const clientTesterMatrix = mergeRoleMatrixWithBaseline({
  [ROLE_IDS.CLIENT_TESTER]: {
    add: ['tickets.view', 'ui_qa.view', 'ui_qa.edit', 'ui_qa.delete'],
    remove: [],
  },
});
const clientTesterCtx = {
  roleMatrix: clientTesterMatrix,
  userOverrides: {},
  loadFailed: false,
};

describe('canAccessRoute', () => {
  it('allows ticket routes for internal users with tickets.view', () => {
    expect(canAccessRoute('/tickets/board', developer)).toBe(true);
    expect(canAccessRoute('/tickets', developer)).toBe(true);
  });

  it('allows ticket routes for external users via AccessAssignment scope', () => {
    expect(canAccessRoute('/tickets', client)).toBe(true);
    expect(canAccessRoute('/tickets/board', client)).toBe(true);
    expect(canAccessRoute('/tickets', clientTester)).toBe(true);
    expect(canAccessRoute('/tickets/board', clientTester)).toBe(true);
  });

  it('hides ticket routes for unassigned users without tickets.view', () => {
    expect(canAccessRoute('/tickets', unassigned)).toBe(false);
    expect(canAccessRoute('/tickets/board', unassigned)).toBe(false);
  });

  it('requires tickets.edit for the edit route and does not treat VIEW as EDIT', () => {
    expect(canAccessRoute('/tickets/WEB-1/edit', developer)).toBe(true);
    expect(canAccessRoute('/tickets/WEB-1/edit', readOnly)).toBe(false);
    expect(canAccessRoute('/tickets/WEB-1/edit', client)).toBe(true);
    expect(canAccessRoute('/tickets', readOnly)).toBe(true);
  });

  it('requires tickets.create for /tickets/new and does not treat VIEW as CREATE', () => {
    expect(canAccessRoute('/tickets/new', developer)).toBe(true);
    expect(canAccessRoute('/tickets/new', readOnly)).toBe(false);
    expect(canAccessRoute('/tickets/new', client)).toBe(true);
  });

  it('blocks teams for users without teams.view', () => {
    expect(canAccessRoute('/teams', unassigned)).toBe(false);
    expect(canAccessRoute('/teams/new', unassigned)).toBe(false);
  });

  it('requires teams.create for /teams/new', () => {
    expect(canAccessRoute('/teams/new', developer)).toBe(false);
    expect(canAccessRoute('/teams/new', admin)).toBe(true);
  });

  it('requires projects.view and clients.view for /projects', () => {
    expect(canAccessRoute('/projects', developer)).toBe(true);
    expect(canAccessRoute('/projects', unassigned)).toBe(false);
  });

  it('requires projects.manage for create and edit project routes', () => {
    expect(canAccessRoute('/projects/new', unassigned)).toBe(false);
    expect(canAccessRoute('/projects/abc123/edit', unassigned)).toBe(false);
    expect(canAccessRoute('/projects/new', admin)).toBe(true);
    expect(canAccessRoute('/projects/abc123/edit', admin)).toBe(true);
  });

  it('requires ui_qa.view for internal /ui-qa routes', () => {
    expect(canAccessRoute('/ui-qa', developer)).toBe(true);
    expect(canAccessRoute('/ui-qa', readOnly)).toBe(true);
    expect(canAccessRoute('/ui-qa', unassigned)).toBe(false);
  });

  it('allows /ui-qa for external users via AccessAssignment scope', () => {
    expect(canAccessRoute('/ui-qa', client)).toBe(true);
    expect(canAccessRoute('/ui-qa', clientTester)).toBe(true);
  });

  it('allows /ui-qa for client_tester when role matrix grants ui_qa.view', () => {
    expect(canAccessRoute('/ui-qa', clientTester, clientTesterCtx)).toBe(true);
    expect(canAccessRoute('/tickets', clientTester, clientTesterCtx)).toBe(true);
  });

  it('denies protected routes when the effective matrix failed to load', () => {
    const failedCtx = { loadFailed: true };
    expect(canAccessRoute('/tickets', developer, failedCtx)).toBe(false);
    expect(canAccessRoute('/projects', admin, failedCtx)).toBe(false);
    expect(canAccessRoute('/profile', developer, failedCtx)).toBe(true);
  });
});

describe('getDefaultRedirect', () => {
  it('returns the board for users with ticket access', () => {
    expect(getDefaultRedirect(developer)).toBe('/tickets/board');
  });

  it('falls back to open routes when restricted pages are unavailable', () => {
    expect(getDefaultRedirect(unassigned)).toBe('/notifications');
  });
});
