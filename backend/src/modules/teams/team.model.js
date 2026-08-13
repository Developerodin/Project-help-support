import mongoose from 'mongoose';
import toJSON from '../../platform/toJSON.plugin.js';

const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    /**
     * null means GLOBAL — usable on every project. This is the whole of the
     * global-team rule; isTeamUsableOnProject() is its only reader.
     */
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    lead: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

teamSchema.index({ project: 1, status: 1 });

teamSchema.plugin(toJSON);

const Team = mongoose.model('Team', teamSchema);
export default Team;
