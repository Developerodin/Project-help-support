import logger from '../../platform/logger.js';
import RbacAuditLog from './rbacAuditLog.model.js';
import RbacAuditOutbox from './rbacAuditOutbox.model.js';

const POLICY_MATRIX_DETAIL_LIMIT = 8000;

function auditCategory(action) {
  if (action.startsWith('whatsapp.')) return 'whatsapp';
  if (action.startsWith('security.')) return 'security';
  if (action.startsWith('user.')) return 'security';
  if (
    action.startsWith('role_matrix')
    || action.startsWith('user_overrides')
    || action.startsWith('board_permissions')
  ) return 'policy';
  return 'access';
}

/** Request-scoped audit metadata (impersonation initiator, trace ids). */
export function auditContextFromRequest(req) {
  if (!req) return {};
  return {
    initiatorUserId: req.impersonation?.by ?? null,
    requestId: req.id ?? null,
    ip: req.ip ?? null,
  };
}

function trimPolicyMatrixDetails(details) {
  if (!details.previous && !details.next) return details;
  const payloadSize = JSON.stringify({
    previous: details.previous,
    next: details.next,
  }).length;
  if (payloadSize <= POLICY_MATRIX_DETAIL_LIMIT) return details;
  const trimmed = { ...details };
  delete trimmed.previous;
  delete trimmed.next;
  trimmed.matrixOmitted = true;
  return trimmed;
}

function normaliseAuditDetails(action, details = {}) {
  let stored = { ...details };
  if (auditCategory(action) === 'policy' && (stored.previous || stored.next)) {
    stored = trimPolicyMatrixDetails(stored);
  }

  const initiatorUserId = stored.initiatorUserId ?? null;
  delete stored.initiatorUserId;

  return { storedDetails: stored, initiatorUserId };
}

/**
 * Audit persistence policy: business mutations succeed independently of audit writes.
 * When audit persistence fails, the event is queued in RbacAuditOutbox for durable retry
 * and the caller receives no error (mutation outcome is not falsely reported as failure).
 */
async function persistRbacAudit(actor, action, details = {}) {
  const targetUserId = details.userId ?? details.targetUserId ?? null;
  const assignmentId = details.assignmentId ?? null;
  const outboxId = details.outboxId ?? null;
  const { storedDetails, initiatorUserId } = normaliseAuditDetails(action, details);

  if (outboxId) {
    const exists = await RbacAuditLog.exists({
      action,
      actor: actor?._id ?? null,
      'details.outboxId': outboxId,
    });
    if (exists) return;
  }

  await RbacAuditLog.create({
    action,
    category: auditCategory(action),
    actor: actor?._id ?? null,
    initiator: initiatorUserId || null,
    targetUser: targetUserId,
    assignment: assignmentId,
    details: storedDetails,
  });
}

async function enqueueAuditOutbox(actor, action, details, error) {
  await RbacAuditOutbox.create({
    action,
    actor: actor?._id ?? null,
    details,
    attempts: 1,
    lastError: error?.message || String(error),
    status: 'pending',
  });
}

function mergeAuditContext(details, auditContext = {}) {
  const merged = { ...details };
  if (auditContext.initiatorUserId) {
    merged.initiatorUserId = String(auditContext.initiatorUserId);
  }
  if (auditContext.requestId) merged.requestId = auditContext.requestId;
  if (auditContext.ip) merged.ip = auditContext.ip;
  return merged;
}

/** `actor` may be null only for `whatsapp.*` events from a number with no account. */
export async function recordRbacAudit(actor, action, details = {}, auditContext = {}) {
  const payload = mergeAuditContext(details, auditContext);
  const actorId = actor ? String(actor._id) : null;
  logger.info(`rbac.${action.replace(/\./g, '_')}`, {
    action,
    actorId,
    initiatorUserId: payload.initiatorUserId ?? null,
    ...payload,
  });

  try {
    await persistRbacAudit(actor, action, payload);
  } catch (err) {
    logger.error('rbac.audit_persist_failed', {
      action,
      actorId,
      error: err.message,
      stack: err.stack,
    });
    try {
      await enqueueAuditOutbox(actor, action, payload, err);
    } catch (outboxErr) {
      logger.error('rbac.audit_outbox_enqueue_failed', {
        action,
        actorId,
        error: outboxErr.message,
        stack: outboxErr.stack,
      });
    }
  }
}

/** Replay pending outbox rows into the audit log (used by tests and future workers). */
export async function retryPendingAuditOutbox({ limit = 50 } = {}) {
  const pending = await RbacAuditOutbox.find({ status: 'pending' })
    .sort({ createdAt: 1 })
    .limit(limit);

  let replayed = 0;
  for (const row of pending) {
    try {
      const outboxId = String(row._id);
      await persistRbacAudit(
        { _id: row.actor },
        row.action,
        { ...row.details, outboxId },
      );
      await RbacAuditOutbox.deleteOne({ _id: row._id });
      replayed += 1;
    } catch (err) {
      await RbacAuditOutbox.updateOne(
        { _id: row._id },
        {
          $inc: { attempts: 1 },
          $set: { lastError: err.message, status: 'pending' },
        },
      );
    }
  }
  return { replayed, remaining: await RbacAuditOutbox.countDocuments({ status: 'pending' }) };
}

export async function getAuditOutboxStats() {
  const [pending, failed] = await Promise.all([
    RbacAuditOutbox.countDocuments({ status: 'pending' }),
    RbacAuditOutbox.countDocuments({ status: 'failed' }),
  ]);
  return { pending, failed };
}
