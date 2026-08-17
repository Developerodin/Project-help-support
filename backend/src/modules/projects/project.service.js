import { resolveProjectModules } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import Client from '../clients/client.model.js';
import Team from '../teams/team.model.js';
import { assertActiveUsers, assertTeamUsable } from '../teams/team.service.js';
import { listEffectiveClientTesters } from '../access/external-auth.service.js';
import {
  assignProjectTeam,
  ensureProjectMigrated,
  getProjectTeamContext,
  listProjectTeamMembers,
  migrateProjectTeamFromLegacy,
  replaceProjectTeamMemberRoles,
} from './project-team-member.service.js';

const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

/** Derive a 2-3 character base key from the first word of the project name. */
export function deriveProjectKeyBase(name) {
  const trimmed = String(name || '').trim();
  const firstWord = trimmed.split(/\s+/).find(Boolean) || trimmed;
  const alpha = firstWord.replace(/[^a-zA-Z0-9]/g, '');
  if (!alpha) return 'PRJ';

  let letters = alpha.toUpperCase();
  if (!/^[A-Z]/.test(letters)) {
    letters = `P${letters}`.replace(/[^A-Z0-9]/g, '');
  }

  let base = letters.slice(0, 3);
  if (base.length < 2) {
    base = (letters + 'X').slice(0, 2);
  }
  return base.slice(0, 10);
}

async function resolveAvailableProjectKey(name, explicitKey) {
  const provided = String(explicitKey || '').trim().toUpperCase();
  if (provided) {
    if (!PROJECT_KEY_PATTERN.test(provided)) {
      throw new ApiError(
        400,
        'INVALID_PROJECT_KEY',
        'Project key must be 2-10 uppercase letters or digits and start with a letter',
      );
    }
    return provided;
  }

  const base = deriveProjectKeyBase(name);
  let candidate = base;
  let suffix = 2;

  while (
    RESERVED_PROJECT_KEYS.includes(candidate)
    || await Project.exists({ key: candidate })
  ) {
    const suffixStr = String(suffix);
    candidate = `${base.slice(0, Math.max(2, 10 - suffixStr.length))}${suffixStr}`;
    suffix += 1;
    if (suffix > 999) {
      throw new ApiError(500, 'PROJECT_KEY_EXHAUSTED', 'Could not generate a unique project key');
    }
  }

  return candidate;
}

async function assertCreateTeam(body) {
  if (!body.team) return;
  const team = await Team.findById(body.team);
  if (!team) throw new ApiError(404, 'TEAM_NOT_FOUND', 'Team not found');
  if (team.project != null) {
    throw new ApiError(
      400,
      'TEAM_PROJECT_MISMATCH',
      'Only global teams can be assigned when creating a project',
    );
  }
}

/** @deprecated Legacy defaults — prefer `team` on create. */
async function assertCreateDefaults(body) {
  await assertCreateTeam(body);
  if (body.defaultTeam && body.defaultTeam !== body.team) {
    await assertCreateTeam({ team: body.defaultTeam });
  }
  await assertActiveUsers([body.defaultAssignee, body.defaultTester]);
}

/**
 * module/page are plain strings on the ticket, validated against the project's
 * taxonomy at write time. Both are optional — a ticket filed against a project
 * with no taxonomy yet (MOB on day one) must still be fileable.
 */
export function assertModuleAndPage(project, moduleLabel, pageLabel) {
  if (!moduleLabel) {
    if (pageLabel) {
      throw new ApiError(400, 'PAGE_WITHOUT_MODULE', 'A page cannot be set without a module');
    }
    return;
  }

  const modules = resolveProjectModules(project);
  const found = modules.find((m) => m.label === moduleLabel);
  if (!found) {
    throw new ApiError(400, 'UNKNOWN_MODULE', `"${moduleLabel}" is not a module of this project`);
  }
  if (pageLabel && !found.pages.some((p) => p.label === pageLabel)) {
    throw new ApiError(400, 'UNKNOWN_PAGE', `"${pageLabel}" is not a page of "${moduleLabel}"`);
  }
}

async function assertTeamPatch(projectId, body) {
  if (body.team === undefined) return;
  if (body.team) await assertTeamUsable(body.team, projectId);
}

/** @deprecated Legacy defaults patch. */
async function assertDefaults(projectId, body) {
  await assertTeamPatch(projectId, body);
  await assertActiveUsers([body.defaultAssignee, body.defaultTester]);
  if (body.defaultTeam) await assertTeamUsable(body.defaultTeam, projectId);
}

async function attachTeamContext(projectJson) {
  if (!projectJson?.id && !projectJson?._id) return projectJson;
  const projectId = projectJson.id || projectJson._id;
  await ensureProjectMigrated(projectId);
  const { team, teamMembers } = await getProjectTeamContext(projectId);
  return { ...projectJson, team, teamMembers };
}

export async function createProject(actor, body) {
  const clientId = body.clientId || body.client;
  if (!clientId) {
    throw new ApiError(400, 'CLIENT_REQUIRED', 'Company is required');
  }

  const client = await Client.findById(clientId);
  if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Company not found');
  if (client.status !== 'active') {
    throw new ApiError(400, 'CLIENT_ARCHIVED', 'Projects can only be created under an active company');
  }

  await assertCreateDefaults(body);

  const key = await resolveAvailableProjectKey(body.name, body.key);
  if (RESERVED_PROJECT_KEYS.includes(key)) {
    throw new ApiError(400, 'RESERVED_PROJECT_KEY', `"${key}" is reserved for imported legacy tickets`);
  }
  if (await Project.exists({ key })) {
    throw new ApiError(400, 'PROJECT_KEY_TAKEN', `A project with key "${key}" already exists`);
  }

  const project = await Project.create({
    client: client._id,
    key,
    name: body.name,
    description: body.description,
    modules: body.modules ?? [],
    team: body.team || body.defaultTeam || undefined,
    createdBy: actor._id,
  });

  if (project.team) {
    await assignProjectTeam(project._id, project.team);
  } else if (body.defaultAssignee || body.defaultTester) {
    await Project.findByIdAndUpdate(project._id, {
      $set: {
        defaultAssignee: body.defaultAssignee || undefined,
        defaultTester: body.defaultTester || undefined,
      },
    });
    await migrateProjectTeamFromLegacy(await Project.findById(project._id));
  }

  const populated = await Project.findById(project._id).populate(['team', 'client']);
  return attachTeamContext(populated.toJSON());
}

export async function listProjects(query = {}) {
  const filter = { status: query.status || 'active' };
  if (query.clientId) filter.client = query.clientId;
  const page = await paginate(Project, filter, {
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy || 'key:asc',
    populate: ['team', 'client'],
  });
  const results = await Promise.all(page.results.map(async (p) => attachTeamContext(p.toJSON())));
  return { ...page, results };
}

export async function getProject(id) {
  const project = await Project.findById(id).populate(['team', 'client']);
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  return attachTeamContext(project.toJSON());
}

export async function updateProject(id, body) {
  if (!(await Project.exists({ _id: id }))) {
    throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  if (body.team !== undefined) {
    await assignProjectTeam(id, body.team);
    const { team, defaultAssignee, defaultTester, defaultTeam, ...rest } = body;
    if (Object.keys(rest).length === 0) {
      return getProject(id);
    }
    body = rest;
  }

  if (Object.keys(body).length === 0) return getProject(id);

  await assertDefaults(id, body);

  const { key: _ignoredKey, nextTicketSeq: _ignoredSeq, team: _ignoredTeam, ...patch } = body;

  const project = await Project.findByIdAndUpdate(
    id, { $set: patch }, { new: true, runValidators: true },
  ).populate(['team', 'client']);

  if (body.defaultAssignee || body.defaultTester || body.defaultTeam) {
    await migrateProjectTeamFromLegacy(project);
  }

  return attachTeamContext(project.toJSON());
}

export async function setProjectTeamMembers(id, members) {
  const rows = await replaceProjectTeamMemberRoles(id, members);
  return { teamMembers: rows };
}

export async function getProjectTeamMembers(id) {
  await ensureProjectMigrated(id);
  return { teamMembers: await listProjectTeamMembers(id) };
}

export async function replaceModules(id, modules) {
  const project = await Project.findByIdAndUpdate(
    id, { $set: { modules } }, { new: true, runValidators: true },
  );
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  return project.toJSON();
}

export async function getProjectClientTesters(id) {
  const project = await Project.findById(id).select('client');
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  if (!project.client) {
    return { projectId: String(id), clientId: null, items: [] };
  }
  const items = await listEffectiveClientTesters(project._id, project.client);
  return {
    projectId: String(project._id),
    clientId: String(project.client),
    items,
  };
}
