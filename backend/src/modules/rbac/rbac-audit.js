import logger from '../../platform/logger.js';
import RbacAuditLog from './rbacAuditLog.model.js';
import RbacAuditOutbox from './rbacAuditOutbox.model.js';

const POLICY_MATRIX_DETAIL_LIMIT = 8000;

function auditCategory(action) {
  if (action.startsWith('whatsapp.')) return 'whatsapp';
  if (action.startsWith('ticket.')) return 'ticket';
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

  const category = auditCategory(action);
  const ticketId = typeof details.ticketId === 'string' && details.ticketId ? details.ticketId : null;

  try {
    await RbacAuditLog.create({
      action,
      category,
      actor: actor?._id ?? null,
      initiator: initiatorUserId || null,
      targetUser: targetUserId,
      assignment: assignmentId,
      ticketId,
      project: category === 'ticket' ? (details.projectId ?? null) : null,
      details: storedDetails,
    });
  } catch (err) {
    // Unique details.outboxId: another replayer already wrote this event.
    if (outboxId && err?.code === 11000) return;
    throw err;
  }
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

export const MAX_AUDIT_OUTBOX_ATTEMPTS = 10;
/** A claim older than this is from a replayer that died mid-row; take it over. */
export const AUDIT_OUTBOX_CLAIM_STALE_MS = 5 * 60 * 1000;

/**
 * Atomically move one row pending -> processing (or take over a stale claim), so
 * two processes replaying at once never work the same row. `skip` holds rows
 * this run already tried, so a failing row is not reclaimed in a loop.
 */
function claimNextAuditOutboxRow(skip, now = Date.now()) {
  return RbacAuditOutbox.findOneAndUpdate(
    {
      _id: { $nin: skip },
      $or: [
        { status: 'pending' },
        { status: 'processing', claimedAt: { $lt: new Date(now - AUDIT_OUTBOX_CLAIM_STALE_MS) } },
      ],
    },
    { $set: { status: 'processing', claimedAt: new Date(now) } },
    { sort: { createdAt: 1 }, new: true },
  );
}

/**
 * Replay pending outbox rows into the audit log (boot + the scheduled sweep).
 * A row that keeps failing moves to 'failed' after MAX_AUDIT_OUTBOX_ATTEMPTS
 * and stays there for a person to look at (getAuditOutboxStats counts them).
 */
export async function retryPendingAuditOutbox({ limit = 50 } = {}) {
  let replayed = 0;
  const tried = [];
  for (let i = 0; i < limit; i += 1) {
    const row = await claimNextAuditOutboxRow(tried);
    if (!row) break;
    tried.push(row._id);
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
      const attempts = (row.attempts ?? 0) + 1;
      const status = attempts >= MAX_AUDIT_OUTBOX_ATTEMPTS ? 'failed' : 'pending';
      if (status === 'failed') {
        logger.error('rbac.audit_outbox_row_failed', { outboxId: String(row._id), attempts, error: err.message });
      }
      await RbacAuditOutbox.updateOne(
        { _id: row._id },
        { $set: { attempts, lastError: err.message, status, claimedAt: null } },
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
