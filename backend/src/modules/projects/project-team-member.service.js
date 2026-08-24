import { PROJECT_TEAM_ROLES, getUserRoles, pickPrimaryRole } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import Team from '../teams/team.model.js';
import { assertActiveUsers, assertTeamUsable } from '../teams/team.service.js';
import Project from './project.model.js';
import ProjectTeamMember from './project-team-member.model.js';

const ROLE_LABELS = Object.freeze({
  team_lead: 'Team Lead',
  developer: 'Developer',
  qa: 'QA',
  member: 'Member',
});

const sameId = (a, b) => !!a && !!b && String(a._id ?? a) === String(b._id ?? b);

export function projectTeamRoleLabel(role) {
  return ROLE_LABELS[role] || role;
}

export async function listProjectTeamMembers(projectId) {
  const rows = await ProjectTeamMember.find({ project: projectId })
    .populate('user', 'name email status role roles')
    .sort({ role: 1, 'user.name': 1 })
    .lean();

  return rows
    .filter((row) => row.user?.status === 'active')
    .map((row) => ({
      id: String(row._id),
      user: {
        id: String(row.user._id),
        name: row.user.name,
        email: row.user.email,
        globalRole: pickPrimaryRole(getUserRoles(row.user)),
        globalRoles: getUserRoles(row.user),
      },
      role: row.role,
      roleLabel: projectTeamRoleLabel(row.role),
      teamId: String(row.team),
    }));
}

async function loadTeamRoster(teamId) {
  const team = await Team.findById(teamId).select('members lead status').lean();
  if (!team || team.status !== 'active') {
    throw new ApiError(404, 'TEAM_NOT_FOUND', 'Team not found');
  }

  const ids = new Set();
  for (const member of team.members || []) ids.add(String(member));
  if (team.lead) ids.add(String(team.lead));
  return { team, userIds: [...ids] };
}

function inferLegacyRole(userId, team, project) {
  if (sameId(team.lead, userId) || sameId(project.defaultAssignee, userId)) {
    return 'team_lead';
  }
  if (sameId(project.defaultTester, userId)) return 'qa';
  return 'member';
}

/**
 * One-time migration from defaultAssignee/defaultTester/defaultTeam into
 * project.team + ProjectTeamMember rows. Idempotent when team is already set.
 */
export async function migrateProjectTeamFromLegacy(projectDoc) {
  const project = projectDoc?.toObject ? projectDoc.toObject() : projectDoc;
  if (!project?._id) return project;

  let teamId = project.team || project.defaultTeam;
  if (!teamId) return project;

  const existing = await ProjectTeamMember.countDocuments({ project: project._id });
  if (!existing) {
    const { team, userIds } = await loadTeamRoster(teamId);
    await assertActiveUsers(userIds);

    const rows = userIds.map((userId) => ({
      project: project._id,
      team: team._id,
      user: userId,
      role: inferLegacyRole(userId, team, project),
    }));

    if (rows.length) {
      await ProjectTeamMember.insertMany(rows, { ordered: false }).catch((err) => {
        if (err?.code !== 11000) throw err;
      });
    }
  }

  if (!project.team || String(project.team) !== String(teamId)) {
    await Project.findByIdAndUpdate(project._id, {
      $set: {
        team: teamId,
        defaultAssignee: null,
        defaultTester: null,
        defaultTeam: null,
      },
    });
  } else if (project.defaultAssignee || project.defaultTester || project.defaultTeam) {
    await Project.findByIdAndUpdate(project._id, {
      $set: { defaultAssignee: null, defaultTester: null, defaultTeam: null },
    });
  }

  return Project.findById(project._id);
}

export async function ensureProjectMigrated(projectId) {
  const project = await Project.findById(projectId);
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  return migrateProjectTeamFromLegacy(project);
}

/**
 * Batch migration for projects still carrying defaultTeam/defaultAssignee/defaultTester.
 * Idempotent — safe on every boot.
 */
export async function migrateAllLegacyProjectTeams() {
  const projects = await Project.find({
    $or: [
      { defaultTeam: { $ne: null } },
      { defaultAssignee: { $ne: null } },
      { defaultTester: { $ne: null } },
    ],
  }).select('_id');

  let migrated = 0;
  let failed = 0;

  for (const row of projects) {
    try {
      await migrateProjectTeamFromLegacy(await Project.findById(row._id));
      migrated += 1;
    } catch {
      failed += 1;
    }
  }

  return { migrated, failed };
}

export async function assignProjectTeam(projectId, teamId) {
  const project = await ensureProjectMigrated(projectId);
  if (!teamId) {
    await ProjectTeamMember.deleteMany({ project: projectId });
    await Project.findByIdAndUpdate(projectId, {
      $set: { team: null, defaultTeam: null, defaultAssignee: null, defaultTester: null },
    });
    return { team: null, teamMembers: [] };
  }

  await assertTeamUsable(teamId, projectId);
  const { team, userIds } = await loadTeamRoster(teamId);
  await assertActiveUsers(userIds);

  await Project.findByIdAndUpdate(projectId, {
    $set: { team: teamId, defaultTeam: null, defaultAssignee: null, defaultTester: null },
  });

  const existing = await ProjectTeamMember.find({ project: projectId }).lean();
  const existingByUser = new Map(existing.map((row) => [String(row.user), row]));

  const nextRows = userIds.map((userId) => {
    const prior = existingByUser.get(String(userId));
    return {
      project: projectId,
      team: team._id,
      user: userId,
      role: prior?.role || inferLegacyRole(userId, team, project),
    };
  });

  await ProjectTeamMember.deleteMany({ project: projectId });
  if (nextRows.length) await ProjectTeamMember.insertMany(nextRows);

  const removedIds = existing
    .filter((row) => !userIds.some((id) => sameId(id, row.user)))
    .map((row) => String(row.user));

  return { removedUserIds: removedIds };
}

export async function replaceProjectTeamMemberRoles(projectId, members = []) {
  const project = await ensureProjectMigrated(projectId);
  if (!project.team) {
    throw new ApiError(400, 'PROJECT_TEAM_REQUIRED', 'Assign a team to this project first');
  }

  const teamId = String(project.team);
  const seen = new Set();
  for (const entry of members) {
    if (!entry?.userId || !entry?.role) {
      throw new ApiError(400, 'INVALID_TEAM_MEMBER', 'Each member needs a userId and role');
    }
    if (!PROJECT_TEAM_ROLES.includes(entry.role)) {
      throw new ApiError(400, 'INVALID_TEAM_ROLE', `Role must be one of: ${PROJECT_TEAM_ROLES.join(', ')}`);
    }
    const key = String(entry.userId);
    if (seen.has(key)) {
      throw new ApiError(400, 'DUPLICATE_TEAM_MEMBER', 'Each user may appear only once');
    }
    seen.add(key);
  }

  await assertActiveUsers(members.map((m) => m.userId));
  const { userIds } = await loadTeamRoster(teamId);

  for (const entry of members) {
    if (!userIds.some((id) => sameId(id, entry.userId))) {
      throw new ApiError(
        400,
        'USER_NOT_ON_TEAM',
        'Project roles may only be assigned to members of the project team',
      );
    }
  }

  await ProjectTeamMember.deleteMany({ project: projectId });
  if (members.length) {
    await ProjectTeamMember.insertMany(members.map((entry) => ({
      project: projectId,
      team: teamId,
      user: entry.userId,
      role: entry.role,
    })));
  }

  return listProjectTeamMembers(projectId);
}

export async function assertAssigneeOnProjectTeam(projectId, teamId, assigneeId) {
  if (!assigneeId) return;

  const project = await Project.findById(projectId).select('team defaultTeam').lean();
  const effectiveTeam = teamId || project?.team || project?.defaultTeam;
  if (!effectiveTeam) return;

  await ensureProjectMigrated(projectId);
  const member = await ProjectTeamMember.findOne({
    project: projectId,
    user: assigneeId,
    team: effectiveTeam,
  }).lean();

  if (!member) {
    throw new ApiError(
      400,
      'ASSIGNEE_NOT_ELIGIBLE',
      'Assignee must be an active member of the project team',
    );
  }
}

export async function findProjectMemberByRole(projectId, teamId, role) {
  if (!projectId || !teamId || !role) return null;
  await ensureProjectMigrated(projectId);
  return ProjectTeamMember.findOne({ project: projectId, team: teamId, role }).lean();
}

export async function getProjectTeamContext(projectId) {
  const project = await ensureProjectMigrated(projectId);
  const populated = await Project.findById(project._id).populate('team', 'name project status');
  const teamMembers = await listProjectTeamMembers(project._id);
  return {
    team: populated?.team ? populated.team.toJSON?.() ?? populated.team : null,
    teamMembers,
  };
}
