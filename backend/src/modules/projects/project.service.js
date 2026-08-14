import { resolveProjectModules } from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import Team from '../teams/team.model.js';
import { assertActiveUsers, assertTeamUsable } from '../teams/team.service.js';
import Project, { RESERVED_PROJECT_KEYS } from './project.model.js';

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

async function assertCreateDefaults(body) {
  await assertActiveUsers([body.defaultAssignee, body.defaultTester]);
  if (!body.defaultTeam) return;

  const team = await Team.findById(body.defaultTeam);
  if (!team) throw new ApiError(404, 'TEAM_NOT_FOUND', 'Team not found');
  if (team.project != null) {
    throw new ApiError(
      400,
      'TEAM_PROJECT_MISMATCH',
      'Only global teams can be set as defaults when creating a project',
    );
  }
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

async function assertDefaults(projectId, body) {
  await assertActiveUsers([body.defaultAssignee, body.defaultTester]);
  if (body.defaultTeam) await assertTeamUsable(body.defaultTeam, projectId);
}

export async function createProject(actor, body) {
  const brand = String(body.brand || '').trim();
  if (!brand) {
    throw new ApiError(400, 'BRAND_REQUIRED', 'Brand is required');
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
    brand,
    key,
    name: body.name,
    description: body.description,
    modules: body.modules ?? [],
    defaultAssignee: body.defaultAssignee || undefined,
    defaultTester: body.defaultTester || undefined,
    defaultTeam: body.defaultTeam || undefined,
    createdBy: actor._id,
  });

  const populated = await Project.findById(project._id)
    .populate(['defaultAssignee', 'defaultTester', 'defaultTeam']);
  return populated.toJSON();
}

export async function listBrands() {
  const brands = await Project.distinct('brand', { status: 'active' });
  return brands.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export async function listProjects(query = {}) {
  const filter = { status: query.status || 'active' };
  const page = await paginate(Project, filter, {
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy || 'brand:asc,key:asc',
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
