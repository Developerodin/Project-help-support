import mongoose from 'mongoose';
import toJSON from '../../platform/toJSON.plugin.js';

/**
 * One row per (person, ticket) they muted; no row means not muted. A muted
 * person hears only what is addressed to them on that ticket (a mention, the
 * ticket being assigned to them).
 *
 * Its own collection rather than a `mutedBy` array on the ticket: muting is a
 * private preference, so it stays out of the ticket JSON every viewer gets,
 * never bumps the ticket's revision or updatedAt, and one fan-out reads the
 * rows for its recipients in one indexed query. Following needs no row: it is
 * the ticket's existing `watchers` list.
 *
 * Rows for a deleted ticket are removed when the ticket is deleted.
 */
const ticketMuteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
  },
  { timestamps: true },
);

ticketMuteSchema.index({ ticket: 1, user: 1 }, { unique: true });

ticketMuteSchema.plugin(toJSON);

const TicketMute = mongoose.model('TicketMute', ticketMuteSchema);
export default TicketMute;

/** Of `userIds`, the ones who muted `ticketId`, as a Set of id strings. */
export async function mutedUserIds(ticketId, userIds) {
  if (!ticketId || userIds.length === 0) return new Set();
  const rows = await TicketMute.find({ ticket: ticketId, user: { $in: userIds } }).select('user').lean();
  return new Set(rows.map((row) => String(row.user)));
}
