import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import User from '../users/user.model.js';
import Team from './team.model.js';

const idOf = (v) => {
  if (!v) return null;
  if (v._id) return String(v._id);
  return String(v);
};

/**
 * The global-team rule, stated once: a ticket may carry team T iff
 * T.project == null || T.project == ticket.project.
 */
export function isTeamUsableOnProject(team, projectId) {
  if (!team) return false;
  if (team.project == null) return true;
  return idOf(team.project) === idOf(projectId);
}

export async function assertTeamUsable(teamId, projectId) {
  const team = await Team.findById(teamId);
  if (!team) throw new ApiError(404, 'TEAM_NOT_FOUND', 'Team not found');
  if (!isTeamUsableOnProject(team, projectId)) {
    throw new ApiError(400, 'TEAM_PROJECT_MISMATCH', 'That team belongs to a different project');
  }
  return team;
}

/** Every User reference on a Team, Project or Ticket must resolve to an ACTIVE user. */
export async function assertActiveUsers(ids) {
  const wanted = ids.filter(Boolean).map(String);
  if (wanted.length === 0) return;

  const found = await User.find({ _id: { $in: wanted }, status: 'active' }).select('_id');
  if (found.length !== new Set(wanted).size) {
    throw new ApiError(
      400, 'INACTIVE_USER_REFERENCE',
      'Every referenced user must exist and be active',
    );
  }
}

export async function createTeam(actor, { name, project = null, lead = null, members = [] }) {
  await assertActiveUsers([lead, ...members]);
  const team = await Team.create({ name, project, lead, members, createdBy: actor._id });
  return team.toJSON();
}

export async function listTeams(query = {}) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.project) {
    // Global teams belong to every project's list, which is what makes them global.
    filter.$or = [{ project: query.project }, { project: null }];
  }

  const page = await paginate(Team, filter, {
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy || 'name:asc',
    populate: ['lead', 'members', 'project'],
  });

  return { ...page, results: page.results.map((t) => t.toJSON()) };
}

export async function getTeam(id) {
  const team = await Team.findById(id).populate(['lead', 'members', 'project']);
  if (!team) throw new ApiError(404, 'TEAM_NOT_FOUND', 'Team not found');
  return team.toJSON();
}

export async function updateTeam(id, body) {
  await assertActiveUsers([body.lead]);

  const team = await Team.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true });
  if (!team) throw new ApiError(404, 'TEAM_NOT_FOUND', 'Team not found');
  return team.toJSON();
}

export async function updateMembers(id, { add = [], remove = [] }) {
  await assertActiveUsers(add);

  // $addToSet then $pull: two single-document updates, both idempotent, so a
  // retried request cannot duplicate a member or double-remove one.
  if (add.length) await Team.updateOne({ _id: id }, { $addToSet: { members: { $each: add } } });
  if (remove.length) await Team.updateOne({ _id: id }, { $pull: { members: { $in: remove } } });

  const team = await Team.findById(id).populate(['lead', 'members', 'project']);
  if (!team) throw new ApiError(404, 'TEAM_NOT_FOUND', 'Team not found');
  return team.toJSON();
}
