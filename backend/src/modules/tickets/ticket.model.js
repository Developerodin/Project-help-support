import mongoose from 'mongoose';
import {
  CATEGORIES, LABELS, SEVERITIES, PRIORITIES, LINK_RELS, STAGE_DECISIONS, STAGE_KEYS,
} from '@pms/shared';
import toJSON from '../../platform/toJSON.plugin.js';

const objectId = mongoose.Schema.Types.ObjectId;

/**
 * Embedding ceiling: comments, activityLog and stageHistory live inside the
 * ticket, matching the lifted code. The ceiling is MongoDB's 16MB document
 * limit — a ticket needs thousands of entries to approach it. Upgrade path
 * when that ever bites: move `comments` to its own collection keyed by ticket.
 */

const stageHistorySchema = new mongoose.Schema(
  {
    from: { type: String, enum: STAGE_KEYS },
    to: { type: String, enum: STAGE_KEYS, required: true },
    by: { type: objectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now },
    // 'approved' | 'rejected' | null — set only on the QA hops.
    decision: { type: String, enum: [...STAGE_DECISIONS, null], default: null },
    note: { type: String, trim: true },
  },
  { _id: true },
);

const activityChangeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    from: { type: mongoose.Schema.Types.Mixed },
    to: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false },
);

const activityLogSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    performedBy: { type: objectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now },
    changes: { type: [activityChangeSchema], default: [] },
  },
  { _id: true },
);

const attachmentSchema = new mongoose.Schema(
  {
    // KEY ONLY. A stored url expires and becomes a dead link in the database.
    // Legacy `dev-tickets/...` keys import verbatim — keys are never parsed.
    key: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    size: { type: Number },
    mimeType: { type: String },
    uploadedBy: { type: objectId, ref: 'User', required: true },
    uploadedAt: { type: Date, default: Date.now },
    /** Client-generated UUID; makes a retried upload a no-op. See attachment.service.js. */
    clientRef: { type: String },
  },
  { _id: true },
);

const reactionSchema = new mongoose.Schema(
  {
    emoji: { type: String, required: true },
    users: { type: [{ type: objectId, ref: 'User' }], default: [] },
  },
  { _id: false },
);

const commentSchema = new mongoose.Schema(
  {
    content: { type: String, required: true, trim: true },
    commentedBy: { type: objectId, ref: 'User', required: true },
    mentions: { type: [{ type: objectId, ref: 'User' }], default: [] },
    reactions: { type: [reactionSchema], default: [] },
    attachments: { type: [attachmentSchema], default: [] },
    clientRef: { type: String },
    editedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const linkSchema = new mongoose.Schema(
  {
    rel: { type: String, enum: LINK_RELS, required: true },
    ticket: { type: objectId, ref: 'Ticket', required: true },
  },
  { _id: false },
);

const ticketSchema = new mongoose.Schema(
  {
    // Plain unique string, NEVER regex-validated against the project key —
    // legacy ids like DEV-MSIN0F6Q-0BFD8854 must store verbatim.
    ticketId: { type: String, required: true, unique: true },
    project: { type: objectId, ref: 'Project', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },

    // Validated against project.modules in the service, not by an enum here.
    module: { type: String, trim: true },
    page: { type: String, trim: true },

    category: { type: String, enum: CATEGORIES },
    labels: { type: [{ type: String, enum: LABELS }], default: [] },
    severity: { type: String, enum: SEVERITIES },
    priority: { type: String, enum: PRIORITIES },

    status: { type: String, enum: STAGE_KEYS, default: 'pending', index: true },

    team: { type: objectId, ref: 'Team', index: true },
    assignedTo: { type: objectId, ref: 'User', index: true },
    testedBy: { type: objectId, ref: 'User' },
    watchers: { type: [{ type: objectId, ref: 'User' }], default: [] },
    createdBy: { type: objectId, ref: 'User', required: true, index: true },

    /** Optimistic concurrency. Every mutation carries it; every read returns it. */
    revision: { type: Number, default: 0 },

    estimatedResolutionAt: { type: Date },
    expectedReleaseDate: { type: Date },

    // Orthogonal to stage, NOT an eleventh stage: a ticket can be in_progress
    // AND blocked. Fields ship now; the set/clear action and badge are P1.
    blocked: { type: Boolean, default: false },
    blockerReason: { type: String, trim: true },
    blockedAt: { type: Date },
    blockedBy: { type: objectId, ref: 'User' },

    stageHistory: { type: [stageHistorySchema], default: [] },
    activityLog: { type: [activityLogSchema], default: [] },
    comments: { type: [commentSchema], default: [] },
    attachments: { type: [attachmentSchema], default: [] },
    links: { type: [linkSchema], default: [] },

    reopenCount: { type: Number, default: 0 },
    reopenedAt: { type: Date },

    // Retained for MIGRATION COMPATIBILITY ONLY. The new pipeline never writes
    // these; analytics reads stageHistory. Imported legacy tickets keep them.
    resolvedAt: { type: Date },
    resolvedBy: { type: objectId, ref: 'User' },

    closedAt: { type: Date },
    closedBy: { type: objectId, ref: 'User' },
    closeReason: { type: String, trim: true },
  },
  { timestamps: true },
);

ticketSchema.index({ project: 1, status: 1 });
ticketSchema.index({ project: 1, createdAt: -1 });
ticketSchema.index({ status: 1, priority: 1 });
ticketSchema.index({ assignedTo: 1, status: 1 });
ticketSchema.index({ team: 1, status: 1 });
ticketSchema.index({ createdBy: 1 });
ticketSchema.index({ createdAt: -1 });
ticketSchema.index({ title: 'text', description: 'text' });

ticketSchema.plugin(toJSON);

const Ticket = mongoose.model('Ticket', ticketSchema);
export default Ticket;
