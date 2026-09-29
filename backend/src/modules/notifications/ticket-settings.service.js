import Ticket from '../tickets/ticket.model.js';
import { assertCanViewTicket, resolveTicketDoc, setWatching } from '../tickets/ticket.service.js';
import TicketMute from './ticketMute.model.js';
import { roleAudienceIds } from './recipients.js';

/**
 * A person's notification settings for one ticket.
 *
 * `following` is true for a watcher, and for anyone who already hears about
 * the ticket by their role on it (`inAudienceByRole`: raiser, assignee,
 * tester, ticket team). For them the follow toggle would change nothing, so
 * `canFollow` is false and the UI explains why instead of offering it.
 */
async function settingsFor(actor, ticket) {
  const actorId = String(actor._id);
  const [byRole, muted] = await Promise.all([
    roleAudienceIds(ticket),
    TicketMute.exists({ ticket: ticket._id, user: actor._id }),
  ]);
  const inAudienceByRole = byRole.has(actorId);
  const watching = (ticket.watchers || []).some((w) => String(w?._id ?? w) === actorId);
  return {
    muted: Boolean(muted),
    following: watching || inAudienceByRole,
    canFollow: !inAudienceByRole,
    inAudienceByRole,
  };
}

/** Same access rule as opening the ticket: no settings for a ticket you cannot see. */
async function viewableTicket(actor, ticketId) {
  const ticket = await resolveTicketDoc(ticketId);
  await assertCanViewTicket(actor, ticket);
  return ticket;
}

export async function getTicketSettings(actor, ticketId) {
  return settingsFor(actor, await viewableTicket(actor, ticketId));
}

/**
 * Following is the ticket's watcher list, the same $addToSet / $pull the
 * watch button does (idempotent, no revision). Watching also grants view
 * access, so un-following can take away a ticket someone only saw as a
 * watcher — exactly what the watch button already does.
 */
export async function updateTicketSettings(actor, ticketId, { muted, following }) {
  const ticket = await viewableTicket(actor, ticketId);

  if (following !== undefined) await setWatching(actor, ticket, Boolean(following));
  if (muted === true) {
    try {
      await TicketMute.updateOne(
        { ticket: ticket._id, user: actor._id },
        { $setOnInsert: { ticket: ticket._id, user: actor._id } },
        { upsert: true },
      );
    } catch (err) {
      // Two mutes at once: the other upsert won, and the ticket is muted.
      if (err?.code !== 11000) throw err;
    }
  } else if (muted === false) {
    await TicketMute.deleteOne({ ticket: ticket._id, user: actor._id });
  }

  return settingsFor(actor, await Ticket.findById(ticket._id).select('createdBy assignedTo testedBy team watchers'));
}
