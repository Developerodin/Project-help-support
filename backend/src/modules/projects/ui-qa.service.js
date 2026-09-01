import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import {
  ADMIN_ROLES,
  can,
  canTransitionQaStatus,
  hasAnyRole,
  isExternalUser,
  QA_STATUSES,
} from '@pms/shared';
import { ApiError } from '../../platform/errors.js';
import { sniffType, safeKey } from '../../platform/upload.js';
import * as defaultStorage from '../../platform/s3.js';
import Project from './project.model.js';
import { assertExternalProjectAccess } from '../access/external-auth.service.js';
import {
  assertScopedPermissionWhenConstrained,
  projectScopeTarget,
} from '../access/scope-enforcement.js';

const QA_FIELDS = ['key', 'qaStatus', 'comments', 'attachments', 'qaStatusHistory'];

function ensureKey(entity) {
  if (!entity.key) entity.key = randomUUID();
  return entity;
}

function ensureModuleKeys(modules = []) {
  for (const mod of modules) {
    ensureKey(mod);
    for (const page of mod.pages || []) {
      ensureKey(page);
      for (const screen of page.screens || []) {
        ensureKey(screen);
      }
    }
  }
  return modules;
}

function pickQaFields(entity = {}) {
  const picked = {};
  for (const field of QA_FIELDS) {
    if (entity[field] !== undefined) picked[field] = entity[field];
  }
  return picked;
}

function matchScreen(existing, incoming) {
  if (existing.key && incoming.key && existing.key === incoming.key) return true;
  return existing.name === incoming.name;
}

function matchPage(existing, incoming) {
  if (existing.key && incoming.key && existing.key === incoming.key) return true;
  return existing.label === incoming.label && (existing.path || '') === (incoming.path || '');
}

function matchModule(existing, incoming) {
  if (existing.key && incoming.key && existing.key === incoming.key) return true;
  return existing.label === incoming.label;
}

/** Preserve QA data when the module catalog is replaced. */
export function mergeModuleQaData(existingModules = [], incomingModules = []) {
  const existingByKey = new Map();
  for (const mod of existingModules) {
    if (mod.key) existingByKey.set(mod.key, mod);
  }

  return incomingModules.map((incomingMod) => {
    const existingMod = (incomingMod.key && existingByKey.get(incomingMod.key))
      || existingModules.find((mod) => matchModule(mod, incomingMod));
    const mergedMod = { ...incomingMod, ...pickQaFields(existingMod) };
    ensureKey(mergedMod);

    mergedMod.pages = (incomingMod.pages || []).map((incomingPage) => {
      const existingPage = (existingMod?.pages || []).find((page) => matchPage(page, incomingPage));
      const mergedPage = { ...incomingPage, ...pickQaFields(existingPage) };
      ensureKey(mergedPage);

      mergedPage.screens = (incomingPage.screens || []).map((incomingScreen) => {
        const existingScreen = (existingPage?.screens || []).find((screen) => matchScreen(screen, incomingScreen));
        const mergedScreen = { ...incomingScreen, ...pickQaFields(existingScreen) };
        ensureKey(mergedScreen);
        return mergedScreen;
      });
      return mergedPage;
    });
    return mergedMod;
  });
}

async function loadProjectForUiQa(projectId, actor, permissionContext) {
  const project = await Project.findById(projectId);
  if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  if (actor) {
    await assertExternalProjectAccess(actor, project._id);
    if (!isExternalUser(actor)) {
      if (!can(actor, 'ui_qa.view', permissionContext)) {
        throw new ApiError(403, 'FORBIDDEN', 'Requires permission: ui_qa.view');
      }
      await assertScopedPermissionWhenConstrained(
        actor,
        'ui_qa.view',
        projectScopeTarget(project),
        permissionContext,
      );
    }
  }
  return project;
}

function assertCanMutateUiQa(actor, permission, permissionContext) {
  if (!actor) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  if (isExternalUser(actor) && permission === 'ui_qa.view') return;
  if (!can(actor, permission, permissionContext)) {
    throw new ApiError(403, 'FORBIDDEN', `Requires permission: ${permission}`);
  }
}

/** @param {{ level: 'module'|'page'|'screen', moduleKey: string, pageKey?: string, screenKey?: string }} entity */
function resolveEntity(modules, entity) {
  const mod = modules.find((row) => row.key === entity.moduleKey);
  if (!mod) throw new ApiError(404, 'UI_QA_ENTITY_NOT_FOUND', 'Module not found');

  if (entity.level === 'module') return { target: mod, level: 'module' };

  const page = (mod.pages || []).find((row) => row.key === entity.pageKey);
  if (!page) throw new ApiError(404, 'UI_QA_ENTITY_NOT_FOUND', 'Page not found');
  if (entity.level === 'page') return { target: page, level: 'page' };

  const screen = (page.screens || []).find((row) => row.key === entity.screenKey);
  if (!screen) throw new ApiError(404, 'UI_QA_ENTITY_NOT_FOUND', 'Screen not found');
  return { target: screen, level: 'screen' };
}

function findComment(target, commentId) {
  const comment = target.comments?.id?.(commentId)
    || target.comments?.find?.((row) => String(row._id) === String(commentId));
  if (!comment) throw new ApiError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
  return comment;
}

function findAttachment(target, attachmentId) {
  const attachment = target.attachments?.id?.(attachmentId)
    || target.attachments?.find?.((row) => String(row._id) === String(attachmentId));
  if (attachment) return attachment;

  for (const comment of target.comments || []) {
    const onComment = comment.attachments?.id?.(attachmentId)
      || comment.attachments?.find?.((row) => String(row._id) === String(attachmentId));
    if (onComment) return onComment;
  }

  throw new ApiError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found');
}

export async function getUiQaProject(projectId, actor, permissionContext) {
  const project = await loadProjectForUiQa(projectId, actor, permissionContext);
  const before = JSON.stringify(project.modules);
  ensureModuleKeys(project.modules);
  if (JSON.stringify(project.modules) !== before) {
    project.markModified('modules');
    await project.save();
  }
  return project.toJSON();
}

function buildUiQaEntityView(modules, entity) {
  const mod = modules.find((row) => row.key === entity.moduleKey);
  if (!mod) throw new ApiError(404, 'UI_QA_ENTITY_NOT_FOUND', 'Module not found');

  if (entity.level === 'module') {
    const pageCount = mod.pages?.length || 0;
    const screenCount = (mod.pages || []).reduce(
      (sum, page) => sum + (page.screens?.length || 0),
      0,
    );
    return {
      entity,
      title: mod.label,
      breadcrumbs: [],
      meta: undefined,
      data: mod,
      counts: { pages: pageCount, screens: screenCount },
    };
  }

  const page = (mod.pages || []).find((row) => row.key === entity.pageKey);
  if (!page) throw new ApiError(404, 'UI_QA_ENTITY_NOT_FOUND', 'Page not found');

  if (entity.level === 'page') {
    return {
      entity,
      title: page.label,
      breadcrumbs: [mod.label],
      meta: page.path || undefined,
      data: page,
      counts: { screens: page.screens?.length || 0 },
    };
  }

  const screen = (page.screens || []).find((row) => row.key === entity.screenKey);
  if (!screen) throw new ApiError(404, 'UI_QA_ENTITY_NOT_FOUND', 'Screen not found');

  return {
    entity,
    title: screen.name,
    breadcrumbs: [mod.label, page.label],
    meta: screen.route || undefined,
    data: screen,
    counts: {},
  };
}

export async function getUiQaEntity(projectId, entity, actor, permissionContext) {
  const project = await loadProjectForUiQa(projectId, actor, permissionContext);
  ensureModuleKeys(project.modules);
  const { target } = resolveEntity(project.modules, entity);
  const view = buildUiQaEntityView(project.modules, entity);
  view.data = target;
  return view;
}

export async function updateUiQaStatus(projectId, entity, body, actor, permissionContext) {
  assertCanMutateUiQa(actor, 'ui_qa.edit', permissionContext);
  const project = await loadProjectForUiQa(projectId, actor, permissionContext);
  ensureModuleKeys(project.modules);
  const { target } = resolveEntity(project.modules, entity);

  const from = target.qaStatus || 'open';
  const to = body.status;
  if (!canTransitionQaStatus(from, to)) {
    throw new ApiError(400, 'INVALID_QA_TRANSITION', `Cannot move from ${from} to ${to}`);
  }

  const historyEntry = {
    from,
    to,
    by: actor._id,
    at: new Date(),
    note: body.note?.trim() || undefined,
  };
  target.qaStatus = to;
  target.qaStatusHistory = [...(target.qaStatusHistory || []), historyEntry];

  await project.save();
  return project.toJSON();
}

export async function addUiQaComment(projectId, entity, body, actor, permissionContext) {
  assertCanMutateUiQa(actor, 'ui_qa.view', permissionContext);
  const project = await loadProjectForUiQa(projectId, actor, permissionContext);
  ensureModuleKeys(project.modules);
  const { target } = resolveEntity(project.modules, entity);

  if (body.clientRef && (target.comments || []).some((row) => row.clientRef === body.clientRef)) {
    return project.toJSON();
  }

  const comment = {
    _id: new mongoose.Types.ObjectId(),
    content: body.content.trim(),
    commentedBy: actor._id,
    clientRef: body.clientRef || undefined,
    attachments: [],
  };
  target.comments = [...(target.comments || []), comment];
  await project.save();
  return project.toJSON();
}

export async function editUiQaComment(projectId, entity, commentId, body, actor, permissionContext) {
  assertCanMutateUiQa(actor, 'ui_qa.edit', permissionContext);
  const project = await loadProjectForUiQa(projectId, actor, permissionContext);
  ensureModuleKeys(project.modules);
  const { target } = resolveEntity(project.modules, entity);
  const comment = findComment(target, commentId);

  const authorId = String(comment.commentedBy?._id || comment.commentedBy);
  const actorId = String(actor._id);
  if (authorId !== actorId && !hasAnyRole(actor, ...ADMIN_ROLES)) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only edit your own comments');
  }

  comment.content = body.content.trim();
  comment.editedAt = new Date();
  await project.save();
  return project.toJSON();
}

export async function deleteUiQaComment(projectId, entity, commentId, actor, permissionContext) {
  assertCanMutateUiQa(actor, 'ui_qa.edit', permissionContext);
  const project = await loadProjectForUiQa(projectId, actor, permissionContext);
  ensureModuleKeys(project.modules);
  const { target } = resolveEntity(project.modules, entity);
  const comment = findComment(target, commentId);

  const authorId = String(comment.commentedBy?._id || comment.commentedBy);
  const actorId = String(actor._id);
  if (authorId !== actorId && !hasAnyRole(actor, ...ADMIN_ROLES)) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only delete your own comments');
  }

  target.comments = (target.comments || []).filter(
    (row) => String(row._id) !== String(commentId),
  );
  await project.save();
  return project.toJSON();
}

export async function addUiQaAttachments(projectId, entity, files, config, actor, permissionContext, opts = {}) {
  const storage = opts.storage ?? defaultStorage;
  const { clientRef } = opts;

  assertCanMutateUiQa(actor, 'ui_qa.view', permissionContext);
  defaultStorage.assertStorageEnabled(config);

  const project = await loadProjectForUiQa(projectId, actor, permissionContext);
  ensureModuleKeys(project.modules);
  const { target } = resolveEntity(project.modules, entity);

  if (clientRef) {
    const replayed = (target.attachments || []).filter((row) => row.clientRef === clientRef);
    if (replayed.length) return project.toJSON();
  }

  const prepared = files.map((file) => {
    const { mime, ext } = sniffType(file.buffer, file.originalname);
    return {
      key: safeKey(String(actor._id), ext, { prefix: 'ui-qa' }),
      name: file.originalname,
      size: file.size,
      mimeType: mime,
      uploadedBy: actor._id,
      uploadedAt: new Date(),
      clientRef,
      buffer: file.buffer,
    };
  });

  for (const item of prepared) {
    await storage.putObject(config, {
      key: item.key, body: item.buffer, contentType: item.mimeType,
    });
  }

  const entries = prepared.map(({ buffer: _buffer, ...rest }) => ({
    ...rest,
    _id: new mongoose.Types.ObjectId(),
  }));
  target.attachments = [...(target.attachments || []), ...entries];
  await project.save();
  return project.toJSON();
}

export async function removeUiQaAttachment(projectId, entity, attachmentId, actor, permissionContext) {
  assertCanMutateUiQa(actor, 'ui_qa.delete', permissionContext);
  const project = await loadProjectForUiQa(projectId, actor, permissionContext);
  ensureModuleKeys(project.modules);
  const { target } = resolveEntity(project.modules, entity);
  findAttachment(target, attachmentId);
  target.attachments = (target.attachments || []).filter(
    (row) => String(row._id) !== String(attachmentId),
  );
  await project.save();
  return project.toJSON();
}

export async function downloadUiQaAttachment(projectId, entity, attachmentId, config, actor, permissionContext, opts = {}) {
  const storage = opts.storage ?? defaultStorage;
  defaultStorage.assertStorageEnabled(config);

  const project = await loadProjectForUiQa(projectId, actor, permissionContext);
  ensureModuleKeys(project.modules);
  const { target } = resolveEntity(project.modules, entity);
  const attachment = findAttachment(target, attachmentId);
  const url = await storage.presignGet(config, attachment.key);
  return { url, attachment };
}

export function assertValidQaStatus(status) {
  if (!QA_STATUSES.includes(status)) {
    throw new ApiError(400, 'INVALID_QA_STATUS', 'Invalid QA status');
  }
}
