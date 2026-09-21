import mongoose from 'mongoose';
import toJSON from '../../platform/toJSON.plugin.js';

const ticketReadStateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
    lastReadAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

ticketReadStateSchema.index({ user: 1, ticket: 1 }, { unique: true });
ticketReadStateSchema.index({ ticket: 1, user: 1 });

ticketReadStateSchema.plugin(toJSON);

const TicketReadState = mongoose.model('TicketReadState', ticketReadStateSchema);
export default TicketReadState;
