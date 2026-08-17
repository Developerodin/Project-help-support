import mongoose from 'mongoose';
import toJSON from '../../platform/toJSON.plugin.js';
import { ApiError } from '../../platform/errors.js';

/**
 * DEV is reserved so a later import of legacy `DEV-MSIN0F6Q-0BFD8854` tickets
 * keeps its original ids without colliding with anything issued here. Nothing
 * in build 1 may take it.
 */
export const RESERVED_PROJECT_KEYS = Object.freeze(['DEV']);

const pageSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    path: { type: String, trim: true },
  },
  { _id: false },
);

const moduleSchema = new mongoose.Schema(
  {
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
    brand: { type: String, required: true, trim: true, index: true, default: 'Uncategorized' },
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
