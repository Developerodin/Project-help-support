import mongoose from 'mongoose';
import { PROJECT_TEAM_ROLES } from '@pms/shared';
import toJSON from '../../platform/toJSON.plugin.js';

const projectTeamMemberSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: PROJECT_TEAM_ROLES, required: true },
  },
  { timestamps: true },
);

projectTeamMemberSchema.index({ project: 1, user: 1 }, { unique: true });
projectTeamMemberSchema.index({ project: 1, team: 1, role: 1 });

projectTeamMemberSchema.plugin(toJSON);

const ProjectTeamMember = mongoose.model('ProjectTeamMember', projectTeamMemberSchema);
export default ProjectTeamMember;
