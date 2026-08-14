import {
  canTransition, stageIndex, stageLabel,
  GUARD_ESTIMATES_FROM_INDEX, GUARD_OWNERSHIP_FROM_INDEX,
} from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import Ticket from './ticket.model.js';
import { resolveTicketDoc, getTicket, assertCanEditTicket } from './ticket.service.js';

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

  if (toIndex >= GUARD_OWNERSHIP_FROM_INDEX && !ticket.team && !ticket.assignedTo) {
    return {
      ok: false,
      code: 'OWNERSHIP_REQUIRED',
      reason: `A team or an assignee is required to enter ${stageLabel(to)}`,
    };
  }

  return { ok: true };
}

/** Layer 2 for this endpoint: the same relationship rule as an ordinary edit. */
export function assertMayTransition(actor, ticket) {
  assertCanEditTicket(actor, ticket);
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
export async function transitionTicket(actor, idOrKey, { to, revision, note, reason }) {
  const ticket = await resolveTicketDoc(idOrKey);
  assertMayTransition(actor, ticket);

  // Replay / stale client: compare revision before canTransition so a
  // already-applied (from->to) does not surface as SAME_STAGE 400.
  if (ticket.revision !== revision) {
    throw conflict(ticket);
  }

  const from = ticket.status;
  const verdict = canTransition(from, to, actor, ticket);
  if (!verdict.ok) throw new ApiError(400, verdict.code, verdict.reason);

  const guard = checkGuards(to, ticket);
  if (!guard.ok) throw new ApiError(400, guard.code, guard.reason, guard.fields);

  // Which text field is mandatory derives from (from, to) â€” which is exactly
  // why Reopen and close-early are not separate endpoints with duplicated
  // guards, history writes and fan-outs.
  if (verdict.isReopen && !note) {
    throw new ApiError(400, 'NOTE_REQUIRED', 'A note is required when reopening a ticket');
  }
  if (verdict.isClose && !reason) {
    throw new ApiError(400, 'REASON_REQUIRED', 'A reason is required when closing a ticket');
  }

  const now = new Date();
  const set = { status: to, revision: revision + 1 };
  const unset = {};
  const inc = {};

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
      },
      activityLog: {
        action: verdict.isReopen ? 'reopened' : 'transitioned',
        performedBy: actor._id,
        at: now,
        changes: [{ field: 'status', from, to }],
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
  return {
    ticket: written.toJSON(),
    event: { type, from, to, actorId: String(actor._id), note, reason, at: now },
    detail: () => getTicket(actor, String(written._id)),
  };
}
