import { ROLE_IDS } from '@pms/shared';

/** Users whose legacy `role` field is authoritative (not yet migrated to roles[]). */
const LEGACY_ROLE_ONLY = {
  $or: [{ roles: { $exists: false } }, { roles: { $size: 0 } }],
};

/** Match users who hold `role` in roles[] or legacy role field. */
export function userHasRoleQuery(role) {
  return {
    $or: [
      { roles: role },
      { role, ...LEGACY_ROLE_ONLY },
    ],
  };
}

/** Exclude users who hold `role` in roles[] or legacy role field. */
export function userExcludesRoleQuery(role) {
  return {
    $nor: [
      { roles: role },
      { role, ...LEGACY_ROLE_ONLY },
    ],
  };
}

export const NOT_SUPER_ADMIN_FILTER = userExcludesRoleQuery(ROLE_IDS.SUPER_ADMIN);
