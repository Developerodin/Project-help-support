import {
  canTransition, stageIndex, stageLabel,
  GUARD_ESTIMATES_FROM_INDEX, GUARD_OWNERSHIP_FROM_INDEX,
  validateTicketEstimateDates, isExternalUser, REOPEN_TARGET,
  userHasEffectivePermission,
  EXTERNAL_ACCEPTANCE_PERMISSION,
} from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { assertActiveUsers } from '../teams/team.service.js';
import { canExternalViewTicket, sanitizeExternalTicket } from '../access/external-auth.service.js';
import Ticket from './ticket.model.js';
import {
  resolveTicketDoc,
  getTicket,
  assertCanViewTicket,
  QA_TESTER_STAGES,
  resolveDefaultTester,
} from './ticket.service.js';
import { getEffectiveBoardRolePolicy } from '../rbac/rbac.service.js';
import { resolvePermissionContext } from '../access/scope-enforcement.js';

/**
 * Layer 3, the half that needs the ticket's own fields â€” which is why it lives
 * on the server rather than in shared/stages.js, where it would run in a
 * browser that has no business enforcing it.
 *
 * Both guards anchor on the DESTINATION index, not on the stage being left.
 * Anchoring on the origin is what forward skips defeat: pending -> in_progress
 * skips under_review entirely, and would skip an origin-anchored gate with it.
 */
export function checkGuards(to, ticket) {
  const toIndex = stageIndex(to);

  if (toIndex >= GUARD_ESTIMATES_FROM_INDEX
      && (!ticket.estimatedResolutionAt || !ticket.expectedReleaseDate)) {
    const fields = {};
    if (!ticket.estimatedResolutionAt) fields.estimatedResolutionAt = 'Required';
    if (!ticket.expectedReleaseDate) fields.expectedReleaseDate = 'Required';
    return {
      ok: false,
      code: 'ESTIMATES_REQUIRED',
      reason: `Both an estimated resolution date and an expected release date are required to enter ${stageLabel(to)}`,
      fields,
    };
  }

  const dateFields = validateTicketEstimateDates(
    ticket.estimatedResolutionAt,
    ticket.expectedReleaseDate,
  );
  if (toIndex >= GUARD_ESTIMATES_FROM_INDEX && dateFields) {
    return {
      ok: false,
      code: 'INVALID_ESTIMATE_DATES',
      reason: 'Expected release cannot be before resolution estimate',
      fields: dateFields,
    };
  }

  if (toIndex >= GUARD_OWNERSHIP_FROM_INDEX && !ticket.team && !ticket.assignedTo) {
    return {
      ok: false,
      code: 'OWNERSHIP_REQUIRED',
      reason: `A team or an assignee is required to enter ${stageLabel(to)}`,
    };
  }

  return { ok: true };
}

/** Layer 2: external visibility gate, then scoped/internal transition rules. */
async function assertMayTransition(actor, ticket, to, permissionContext = null) {
  if (isExternalUser(actor)) {
    if (!(await canExternalViewTicket(actor, ticket))) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this ticket');
    }

    const clientStageMove =
      (ticket.status === 'live' && to === 'closed')
      || (ticket.status === 'closed' && to === REOPEN_TARGET);
    if (!clientStageMove) {
      throw new ApiError(
        403,
        'FORBIDDEN',
        `Clients may only move Live tickets to Closed, or reopen Closed tickets to ${stageLabel(REOPEN_TARGET)}`,
      );
    }
    const ctx = await resolvePermissionContext(actor, permissionContext);
    if (!userHasEffectivePermission(actor, EXTERNAL_ACCEPTANCE_PERMISSION, ctx)) {
      throw new ApiError(403, 'FORBIDDEN', 'Your role cannot close or reopen tickets');
    }
    return;
  }

  // Stage moves are gated by board lane capabilities (canTransition below),
  // not tickets.edit — same rule as the board view.
  await assertCanViewTicket(actor, ticket, permissionContext);
}

function conflict(current) {
  return new ApiError(
    409, 'STAGE_CONFLICT',
    `This ticket is now in ${stageLabel(current.status)}. Reload before transitioning.`,
    { currentStatus: current.status, currentRevision: current.revision },
  );
}

/**
 * The transition, as ONE conditional update.
 *
 *   read -> canTransition -> save             races: two requests read one stage
 *   findOneAndUpdate({ status, revision })     single winner, structurally
 *
 * A null result means someone else moved first. That also makes a replayed
 * request safe without an idempotency key: the second attempt finds a stage
 * that no longer matches and is rejected cleanly.
 */
/**
 * Attachments are uploaded on /attachments FIRST, then linked here by id. The
 * ids are re-read off the ticket rather than trusted from the body, so a caller
 * cannot file another ticket's attachment — or a made-up id — as evidence.
 */
function resolveEvidence(ticket, attachmentIds) {
  if (!attachmentIds?.length) return [];
  return attachmentIds.map((id) => {
    const found = ticket.attachments.id(id);
    if (!found) {
      throw new ApiError(
        400, 'ATTACHMENT_NOT_FOUND',
        'Upload the report attachment to this ticket before filing it with the move',
      );
    }
    return found.toObject();
  });
}

export async function transitionTicket(actor, idOrKey, {
  to, revision, note, reason, attachmentIds,
}, permissionContext = null) {
  const ticket = await resolveTicketDoc(idOrKey);
  const boardPolicy = await getEffectiveBoardRolePolicy();
  await assertMayTransition(actor, ticket, to, permissionContext);

  // Replay / stale client: compare revision before canTransition so a
  // already-applied (from->to) does not surface as SAME_STAGE 400.
  if (ticket.revision !== revision) {
    throw conflict(ticket);
  }

  const from = ticket.status;
  const ctx = await resolvePermissionContext(actor, permissionContext);
  const verdict = canTransition(from, to, actor, ticket, boardPolicy, ctx);
  if (!verdict.ok) throw new ApiError(400, verdict.code, verdict.reason);

  const guard = checkGuards(to, ticket);
  if (!guard.ok) throw new ApiError(400, guard.code, guard.reason, guard.fields);

  // Which text field is mandatory derives from (from, to) â€” which is exactly
  // why Reopen and close-early are not separate endpoints with duplicated
  // guards, history writes and fan-outs.
  if (verdict.isReopen && !note) {
    throw new ApiError(
      400, 'NOTE_REQUIRED',
      verdict.decision === 'rejected'
        ? 'A QA report is required when rejecting a ticket'
        : 'A note is required when reopening a ticket',
    );
  }
  if (verdict.isClose && !reason) {
    throw new ApiError(400, 'REASON_REQUIRED', 'A reason is required when closing a ticket');
  }

  const evidence = resolveEvidence(ticket, attachmentIds);

  const now = new Date();
  const set = { status: to, revision: revision + 1 };
  const unset = {};
  const inc = {};
  const activityChanges = [{ field: 'status', from, to }];

  if (QA_TESTER_STAGES.has(to) && !ticket.testedBy) {
    const testerId = await resolveDefaultTester(ticket);
    if (testerId) {
      await assertActiveUsers([testerId]);
      set.testedBy = testerId;
      activityChanges.push({ field: 'testedBy', from: ticket.testedBy ?? null, to: testerId });
    }
  }

  if (verdict.isClose) {
    set.closedAt = now;
    set.closedBy = actor._id;
    set.closeReason = reason;
  }
  if (verdict.isReopen) {
    set.reopenedAt = now;
    inc.reopenCount = 1;
    // A ticket reading `in_progress` with `closedAt: yesterday` is semantically
    // broken. The document holds current state; stageHistory keeps the close.
    if (from === 'closed') {
      unset.closedAt = '';
      unset.closedBy = '';
      unset.closeReason = '';
    }
  }

  const update = {
    $set: set,
    $push: {
      stageHistory: {
        from,
        to,
        by: actor._id,
        at: now,
        decision: verdict.decision,
        note: note ?? reason ?? undefined,
        attachments: evidence,
      },
      activityLog: {
        action: verdict.isReopen ? 'reopened' : 'transitioned',
        performedBy: actor._id,
        at: now,
        changes: activityChanges,
      },
    },
  };
  if (Object.keys(unset).length) update.$unset = unset;
  if (Object.keys(inc).length) update.$inc = inc;

  const written = await Ticket.findOneAndUpdate(
    { _id: ticket._id, status: from, revision },
    update,
    { new: true },
  );

  if (!written) {
    const current = await Ticket.findById(ticket._id).select('status revision');
    throw conflict(current ?? ticket);
  }

  let type = 'TICKET_STAGE_CHANGED';
  if (verdict.isReopen) type = 'TICKET_REOPENED';
  else if (verdict.isClose) type = 'TICKET_CLOSED';

  // The event is RETURNED rather than dispatched: the stage machine emits, and
  // knows nothing about recipients. Phase 4's notification module consumes it.
  const json = written.toJSON();
  return {
    ticket: isExternalUser(actor) ? sanitizeExternalTicket(json, { viewerId: actor._id }) : json,
    event: { type, from, to, actorId: String(actor._id), note, reason, at: now },
    detail: () => getTicket(actor, String(written._id)),
  };
}
