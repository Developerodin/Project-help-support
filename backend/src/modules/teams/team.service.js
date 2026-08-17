import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import Project from '../projects/project.model.js';
import Ticket from '../tickets/ticket.model.js';
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

const ZERO_STATS = Object.freeze({ total: 0, open: 0, overdue: 0 });

/**
 * Ticket load for a whole page of teams in ONE aggregate, never a count per
 * team. Served by the existing { team: 1, status: 1 } index.
 *
 * Overdue repeats buildTicketFilter()'s `overdue` clause and the client's
 * isOverdue(): a past estimatedResolutionAt on a ticket that is neither closed
 * nor live. The $type guard is load-bearing and must stay a $type check — a
 * MISSING estimate compares as lower than any date, and `$ne: [field, null]`
 * does NOT catch it (missing is not null in an aggregation expression), so a
 * null-guard lets every estimate-less ticket read as overdue.
 */
async function ticketStatsByTeam(teamIds) {
  if (teamIds.length === 0) return new Map();
  const now = new Date();
  const rows = await Ticket.aggregate([
    { $match: { team: { $in: teamIds } } },
    {
      $group: {
        _id: '$team',
        total: { $sum: 1 },
        open: { $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 0, 1] } },
        overdue: {
          $sum: {
            $cond: [{
              $and: [
                { $eq: [{ $type: '$estimatedResolutionAt' }, 'date'] },
                { $lt: ['$estimatedResolutionAt', now] },
                { $not: [{ $in: ['$status', ['closed', 'live']] }] },
              ],
            }, 1, 0],
          },
        },
      },
    },
  ]);
  return new Map(rows.map((r) => [
    String(r._id),
    { total: r.total, open: r.open, overdue: r.overdue },
  ]));
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

  const stats = await ticketStatsByTeam(page.results.map((t) => t._id));
  const teamIds = page.results.map((t) => t._id);
  const projectRows = teamIds.length
    ? await Project.find({ team: { $in: teamIds }, status: 'active' }).select('key name team').lean()
    : [];
  const projectsByTeam = new Map(teamIds.map((id) => [String(id), []]));
  for (const row of projectRows) {
    projectsByTeam.get(String(row.team))?.push({ id: String(row._id), key: row.key, name: row.name });
  }

  return {
    ...page,
    results: page.results.map((t) => ({
      ...t.toJSON(),
      stats: stats.get(String(t._id)) ?? ZERO_STATS,
      projects: projectsByTeam.get(String(t._id)) ?? [],
    })),
  };
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
