import mongoose from 'mongoose';

/** One WhatsApp sender per user, and one user per sender. */
const linkSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    // Phone number in international form without "+", as Meta sends it (wa_id).
    waId: { type: String, required: true, unique: true },
    // Meta's business-scoped user id; present once WhatsApp sends it, and the
    // only identifier left if the user switches to a username.
    bsuid: { type: String, default: undefined },
    linkedAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date, default: null },
  },
  { versionKey: false },
);
linkSchema.index({ bsuid: 1 }, { unique: true, sparse: true });
export const WhatsappLink = mongoose.models.WhatsappLink || mongoose.model('WhatsappLink', linkSchema);

/** A pending "LINK <code>" the user was shown in the app. Hash only; gone after 10 minutes. */
const codeSchema = new mongoose.Schema(
  {
    _id: { type: String }, // sha256 of the code
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
codeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const WhatsappLinkCode = mongoose.models.WhatsappLinkCode || mongoose.model('WhatsappLinkCode', codeSchema);

/**
 * Short-lived state keyed by a string:
 *   "seen:<message id>"   Meta redelivers; a message is answered once.
 *   "fail:<wa id>"        wrong link codes from one sender, to stop guessing.
 *   "chat:<user id>"      the recent conversation, kept server-side so it can't be forged,
 *                         and the new-ticket draft waiting for a yes (the ticket body).
 */
const stateSchema = new mongoose.Schema(
  {
    _id: { type: String },
    count: { type: Number, default: 0 },
    messages: { type: [{ _id: false, role: String, content: String }], default: undefined },
    draft: { type: mongoose.Schema.Types.Mixed, default: undefined },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
stateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const WhatsappState = mongoose.models.WhatsappState || mongoose.model('WhatsappState', stateSchema);
