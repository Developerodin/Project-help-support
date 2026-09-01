import mongoose from 'mongoose';
import toJSON from '../../platform/toJSON.plugin.js';
import { ApiError } from '../../platform/errors.js';
import { QA_STATUSES } from '@pms/shared';

/**
 * DEV is reserved so a later import of legacy `DEV-MSIN0F6Q-0BFD8854` tickets
 * keeps its original ids without colliding with anything issued here. Nothing
 * in build 1 may take it.
 */
export const RESERVED_PROJECT_KEYS = Object.freeze(['DEV']);

const objectId = mongoose.Schema.Types.ObjectId;

const uiQaAttachmentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    size: { type: Number },
    mimeType: { type: String },
    uploadedBy: { type: objectId, ref: 'User', required: true },
    uploadedAt: { type: Date, default: Date.now },
    clientRef: { type: String },
  },
  { _id: true },
);

const uiQaStatusHistorySchema = new mongoose.Schema(
  {
    from: { type: String, enum: QA_STATUSES },
    to: { type: String, enum: QA_STATUSES, required: true },
    by: { type: objectId, ref: 'User', required: true },
    at: { type: Date, default: Date.now },
    note: { type: String, trim: true },
  },
  { _id: true },
);

const uiQaCommentSchema = new mongoose.Schema(
  {
    content: { type: String, required: true, trim: true },
    commentedBy: { type: objectId, ref: 'User', required: true },
    attachments: { type: [uiQaAttachmentSchema], default: [] },
    clientRef: { type: String },
    editedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const uiQaFields = {
  key: { type: String, trim: true },
  qaStatus: { type: String, enum: QA_STATUSES, default: 'open' },
  comments: { type: [uiQaCommentSchema], default: [] },
  attachments: { type: [uiQaAttachmentSchema], default: [] },
  qaStatusHistory: { type: [uiQaStatusHistorySchema], default: [] },
};

const screenSchema = new mongoose.Schema(
  {
    ...uiQaFields,
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ['list', 'detail', 'create', 'edit', 'other'],
      default: 'other',
    },
    route: { type: String, trim: true },
    status: {
      type: String,
      enum: ['active', 'draft', 'deprecated'],
      default: 'active',
    },
    documentation: { type: String, trim: true },
  },
  { _id: false },
);

const pageSchema = new mongoose.Schema(
  {
    ...uiQaFields,
    label: { type: String, required: true, trim: true },
    path: { type: String, trim: true },
    screens: { type: [screenSchema], default: [] },
  },
  { _id: false },
);

const moduleSchema = new mongoose.Schema(
  {
    ...uiQaFields,
    label: { type: String, required: true, trim: true },
    pages: { type: [pageSchema], default: [] },
  },
  { _id: false },
);

const projectSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      // Immutable because it is embedded in every ticket id already issued.
      // Mongoose enforces this on save() and strips it from update operators.
      immutable: true,
      set: (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
      match: [/^[A-Z][A-Z0-9]{1,9}$/, 'Project key must be 2-10 uppercase letters or digits'],
    },
    brand: { type: String, trim: true, index: true },
    /** Parent company (Client entity). Required for all new projects. */
    client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    /**
     * The next sequence number to hand out. Allocated by allocateTicketSeq only —
     * never $set from a service, or two tickets will share an id.
     */
    nextTicketSeq: { type: Number, default: 1, min: 1 },
    modules: { type: [moduleSchema], default: [] },
    /** Assigned team for this project — source of eligible ticket assignees. */
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    /** @deprecated Use `team` + ProjectTeamMember. Kept for migration reads only. */
    defaultAssignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** @deprecated Use ProjectTeamMember roles. Kept for migration reads only. */
    defaultTester: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** @deprecated Use `team`. Kept for migration reads only. */
    defaultTeam: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

projectSchema.plugin(toJSON);

/**
 * The whole point of this file. One findOneAndUpdate: the $inc and the read are
 * the same operation, so concurrent callers cannot observe the same value.
 * `new: false` returns the PRE-increment document, which holds the number this
 * caller owns.
 *
 * ponytail: a consumed sequence is never returned to the pool. A create that
 * fails after allocation leaves a gap in the ids. Gaps are fine; duplicates are not.
 */
projectSchema.statics.allocateTicketSeq = async function allocateTicketSeq(projectId) {
  const before = await this.findOneAndUpdate(
    { _id: projectId },
    { $inc: { nextTicketSeq: 1 } },
    { new: false, projection: { key: 1, nextTicketSeq: 1 } },
  );

  if (!before) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  return { key: before.key, seq: before.nextTicketSeq };
};

const Project = mongoose.model('Project', projectSchema);
export default Project;
