import AccessAssignment from './accessAssignment.model.js';

/** Mongo clause matching shared isAssignmentEffectivelyActive expiry semantics. */
export function notExpiredAt(now = new Date()) {
  return { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] };
}

/** Active assignment filter — status active and not expired. */
export function activeNotExpiredFilter(criteria = {}, now = new Date()) {
  if (criteria.$or) {
    const { $or, ...rest } = criteria;
    return {
      $and: [
        { status: 'active', ...rest, $or },
        notExpiredAt(now),
      ],
    };
  }
  return { status: 'active', ...criteria, ...notExpiredAt(now) };
}

/**
 * Expired rows still marked active block the partial unique index. Revoke them
 * deterministically before re-granting the same user/role/scope.
 */
export async function revokeExpiredActiveDuplicates({
  userId,
  role,
  clientId = null,
  projectId = null,
  reason = 'expired',
}) {
  const now = new Date();
  await AccessAssignment.updateMany(
    {
      user: userId,
      role,
      client: clientId,
      project: projectId,
      status: 'active',
      expiresAt: { $ne: null, $lte: now },
    },
    { $set: { status: 'revoked', reason } },
  );
}
