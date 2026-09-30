import mongoose from 'mongoose';

const objectId = mongoose.Schema.Types.ObjectId;

/**
 * The whole ticket as it was when deleted: comments, history, attachment keys
 * and all. Deleting a ticket removes it from every surface; this is what keeps
 * the content recoverable. Written before the delete, so a failed archive
 * write means no delete. No TTL: kept until someone decides otherwise.
 *
 * ponytail: `snapshot` is the raw document, so it is as large as the ticket
 * was. A ticket near the 16MB document limit cannot be archived (and so cannot
 * be deleted) — none come close today.
 */
const deletedTicketSchema = new mongoose.Schema(
  {
    ticket: { type: objectId, required: true, index: true },
    ticketId: { type: String, required: true, index: true },
    project: { type: objectId, ref: 'Project' },
    deletedBy: { type: objectId, ref: 'User', required: true },
    deletedAt: { type: Date, default: Date.now },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { minimize: false },
);

deletedTicketSchema.index({ project: 1, deletedAt: -1 });

const DeletedTicket = mongoose.model('DeletedTicket', deletedTicketSchema);
export default DeletedTicket;
