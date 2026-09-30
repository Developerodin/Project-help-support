import { describe, expect, it } from 'vitest';
import { ROLE_IDS, ROLE_PERMISSIONS, buildRoleMatrix, roleMatrixToRecord } from '@pms/shared';
import {
  filterEffectivelyActiveAssignments,
  getEffectivePermissions,
  getRoleBaselinePermissions,
  isAssignmentEffectivelyActive,
} from '../matrix-utils.js';

describe('people permission summaries', () => {
  const user = {
    id: 'user-1',
    role: ROLE_IDS.DEVELOPER,
    roles: [ROLE_IDS.DEVELOPER],
  };

  it('reflects customized role matrix in baseline and effective counts', () => {
    const customized = roleMatrixToRecord(buildRoleMatrix(ROLE_PERMISSIONS));
    customized[ROLE_IDS.DEVELOPER] = customized[ROLE_IDS.DEVELOPER].filter(
      (permission) => permission !== 'tickets.create',
    );

    const staticBaseline = getRoleBaselinePermissions(user).size;
    const matrixBaseline = getRoleBaselinePermissions(user, customized).size;

    expect(matrixBaseline).toBe(staticBaseline - 1);
    expect(getEffectivePermissions(user, { roleMatrix: customized }).size).toBe(matrixBaseline);
  });

  it('uses matrix-aware baseline for effective permission resolution', () => {
    const customized = roleMatrixToRecord(buildRoleMatrix(ROLE_PERMISSIONS));
    customized[ROLE_IDS.DEVELOPER] = ['tickets.view'];

    expect(getRoleBaselinePermissions(user, customized).has('tickets.view')).toBe(true);
    expect(getRoleBaselinePermissions(user, customized).has('tickets.create')).toBe(false);
    expect(getEffectivePermissions(user, { roleMatrix: customized }).has('tickets.create')).toBe(false);
  });
});

describe('scoped assignment effective-active filter', () => {
  const now = new Date('2026-08-24T12:00:00.000Z');

  it('treats active rows with past expiresAt as inactive', () => {
    const expiredActive = {
      id: 'asg-expired',
      status: 'active',
      expiresAt: '2026-08-01T00:00:00.000Z',
    };

    expect(isAssignmentEffectivelyActive(expiredActive, now)).toBe(false);
  });

  it('keeps active rows without expiry or with future expiry', () => {
    const noExpiry = { id: 'asg-open', status: 'active' };
    const futureExpiry = {
      id: 'asg-future',
      status: 'active',
      expiresAt: '2026-09-01T00:00:00.000Z',
    };

    expect(isAssignmentEffectivelyActive(noExpiry, now)).toBe(true);
    expect(isAssignmentEffectivelyActive(futureExpiry, now)).toBe(true);
  });

  it('excludes expired active rows from scoped grant counts/lists', () => {
    const assignments = [
      { id: 'asg-open', status: 'active' },
      {
        id: 'asg-expired',
        status: 'active',
        expiresAt: '2026-08-01T00:00:00.000Z',
      },
      { id: 'asg-revoked', status: 'revoked', expiresAt: '2026-08-01T00:00:00.000Z' },
    ];

    expect(filterEffectivelyActiveAssignments(assignments, now)).toEqual([
      { id: 'asg-open', status: 'active' },
    ]);
  });
});
