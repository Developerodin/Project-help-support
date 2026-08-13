import { resolveProjectModules } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import { assertActiveUsers, assertTeamUsable } from '../teams/team.service.js';
import Project, { RESERVED_PROJECT_KEYS } from './project.model.js';

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

async function assertDefaults(projectId, body) {
  await assertActiveUsers([body.defaultAssignee, body.defaultTester]);
  if (body.defaultTeam) await assertTeamUsable(body.defaultTeam, projectId);
}

export async function createProject(actor, body) {
  const key = String(body.key || '').trim().toUpperCase();
  if (RESERVED_PROJECT_KEYS.includes(key)) {
    throw new ApiError(400, 'RESERVED_PROJECT_KEY', `"${key}" is reserved for imported legacy tickets`);
  }
  if (await Project.exists({ key })) {
    throw new ApiError(400, 'PROJECT_KEY_TAKEN', `A project with key "${key}" already exists`);
  }

  const project = await Project.create({
    key,
    name: body.name,
    description: body.description,
    createdBy: actor._id,
  });
  return project.toJSON();
}

export async function listProjects(query = {}) {
  const filter = { status: query.status || 'active' };
  const page = await paginate(Project, filter, {
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy || 'key:asc',
    populate: ['defaultAssignee', 'defaultTester', 'defaultTeam'],
  });
  return { ...page, results: page.results.map((p) => p.toJSON()) };
}

export async function getProject(id) {
  const project = await Project.findById(id)
    .populate(['defaultAssignee', 'defaultTester', 'defaultTeam']);
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  return project.toJSON();
}

export async function updateProject(id, body) {
  if (!(await Project.exists({ _id: id }))) {
    throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  await assertDefaults(id, body);

  // `key` and `nextTicketSeq` are never patchable. `key` is immutable in the
  // schema as well; stripping here makes the intent visible at the call site.
  const { key: _ignoredKey, nextTicketSeq: _ignoredSeq, ...patch } = body;

  const project = await Project.findByIdAndUpdate(
    id, { $set: patch }, { new: true, runValidators: true },
  ).populate(['defaultAssignee', 'defaultTester', 'defaultTeam']);

  return project.toJSON();
}

export async function replaceModules(id, modules) {
  const project = await Project.findByIdAndUpdate(
    id, { $set: { modules } }, { new: true, runValidators: true },
  );
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  return project.toJSON();
}
