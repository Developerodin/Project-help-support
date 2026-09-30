import { describe, it, expect } from 'vitest';
import { ROLE_IDS } from '@pms/shared';
import { capRole, capStatus, canAccessTeams, canAccessProjects } from '../profile-utils.js';

describe('capRole', () => {
  it('renders every one of the nine role ids as its human label, via lookup', () => {
    expect(capRole(ROLE_IDS.SUPER_ADMIN)).toBe('Super Admin');
    expect(capRole(ROLE_IDS.PROJECT_ADMIN)).toBe('Project Admin');
    expect(capRole(ROLE_IDS.READ_ONLY)).toBe('Read Only');
    expect(capRole(ROLE_IDS.CLIENT_TESTER)).toBe('Client Tester');
  });

  it('falls back gracefully for an unknown or missing role', () => {
    expect(capRole(undefined)).toBe('Unknown Role');
    expect(capRole('not-a-real-role')).toBe('Unknown Role');
  });
});

describe('capStatus', () => {
  it('still capitalizes a plain status word', () => {
    expect(capStatus('active')).toBe('Active');
    expect(capStatus(undefined)).toBe('Unknown');
  });
});

describe('canAccessTeams', () => {
  it('allows Super Admin, Admin and Project Admin only', () => {
    expect(canAccessTeams(ROLE_IDS.SUPER_ADMIN)).toBe(true);
    expect(canAccessTeams(ROLE_IDS.ADMIN)).toBe(true);
    expect(canAccessTeams(ROLE_IDS.PROJECT_ADMIN)).toBe(true);
    expect(canAccessTeams(ROLE_IDS.DEVELOPER)).toBe(false);
    expect(canAccessTeams(ROLE_IDS.CLIENT)).toBe(false);
  });
});

describe('canAccessProjects', () => {
  it('allows Super Admin and Admin only', () => {
    expect(canAccessProjects(ROLE_IDS.SUPER_ADMIN)).toBe(true);
    expect(canAccessProjects(ROLE_IDS.ADMIN)).toBe(true);
    expect(canAccessProjects(ROLE_IDS.PROJECT_ADMIN)).toBe(false);
  });
});
