import logger from '../../platform/logger.js';
import RbacAuditLog from './rbacAuditLog.model.js';
import RbacAuditOutbox from './rbacAuditOutbox.model.js';

function auditCategory(action) {
  if (
    action.startsWith('role_matrix')
    || action.startsWith('user_overrides')
    || action.startsWith('board_permissions')
  ) return 'policy';
  return 'access';
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
  const storedDetails = { ...details };
  delete storedDetails.userId;
  delete storedDetails.targetUserId;
  delete storedDetails.assignmentId;
  delete storedDetails.outboxId;

  if (outboxId) {
    const exists = await RbacAuditLog.exists({
      action,
      actor: actor._id,
      'details.outboxId': outboxId,
    });
    if (exists) return;
  }

  await RbacAuditLog.create({
    action,
    category: auditCategory(action),
    actor: actor._id,
    targetUser: targetUserId,
    assignment: assignmentId,
    details: storedDetails,
  });
}

async function enqueueAuditOutbox(actor, action, details, error) {
  await RbacAuditOutbox.create({
    action,
    actor: actor._id,
    details,
    attempts: 1,
    lastError: error?.message || String(error),
    status: 'pending',
  });
}

export async function recordRbacAudit(actor, action, details = {}) {
  logger.info(`rbac.${action.replace('.', '_')}`, {
    action,
    actorId: String(actor._id),
    ...details,
  });

  try {
    await persistRbacAudit(actor, action, details);
  } catch (err) {
    logger.error('rbac.audit_persist_failed', {
      action,
      actorId: String(actor._id),
      error: err.message,
      stack: err.stack,
    });
    try {
      await enqueueAuditOutbox(actor, action, details, err);
    } catch (outboxErr) {
      logger.error('rbac.audit_outbox_enqueue_failed', {
        action,
        actorId: String(actor._id),
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
