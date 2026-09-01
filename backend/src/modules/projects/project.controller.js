import catchAsync from '../../platform/catchAsync.js';
import { ApiError } from '../../platform/errors.js';
import * as projectService from './project.service.js';
import * as uiQaService from './ui-qa.service.js';

export function parseUiQaJsonField(value, fieldName) {
  if (value == null || value === '' || value === 'undefined') {
    throw new ApiError(400, 'VALIDATION_ERROR', `${fieldName} is required`);
  }
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    if (parsed == null || typeof parsed !== 'object') {
      throw new ApiError(400, 'VALIDATION_ERROR', `${fieldName} must be a JSON object`);
    }
    return parsed;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(400, 'VALIDATION_ERROR', `${fieldName} must be valid JSON`);
  }
}

export const list = catchAsync(async (req, res) => {
  res.json(await projectService.listProjects(req.query, req.user, req.permissionContext));
});

export const create = catchAsync(async (req, res) => {
  res.status(201).json(await projectService.createProject(req.user, req.body, req.permissionContext));
});

export const get = catchAsync(async (req, res) => {
  res.json(await projectService.getProject(req.params.id, req.user, req.permissionContext));
});

export const update = catchAsync(async (req, res) => {
  res.json(await projectService.updateProject(req.params.id, req.body, req.user, req.permissionContext));
});

export const modules = catchAsync(async (req, res) => {
  res.json(await projectService.replaceModules(
    req.params.id, req.body.modules, req.user, req.permissionContext,
  ));
});

export const uiQaGet = catchAsync(async (req, res) => {
  res.json(await uiQaService.getUiQaProject(req.params.id, req.user, req.permissionContext));
});

export const uiQaGetEntity = catchAsync(async (req, res) => {
  res.json(await uiQaService.getUiQaEntity(
    req.params.id,
    req.query.entity,
    req.user,
    req.permissionContext,
  ));
});

export const uiQaStatus = catchAsync(async (req, res) => {
  res.json(await uiQaService.updateUiQaStatus(
    req.params.id, req.body.entity, req.body, req.user, req.permissionContext,
  ));
});

export const uiQaAddComment = catchAsync(async (req, res) => {
  res.json(await uiQaService.addUiQaComment(
    req.params.id, req.body.entity, req.body, req.user, req.permissionContext,
  ));
});

export const uiQaEditComment = catchAsync(async (req, res) => {
  res.json(await uiQaService.editUiQaComment(
    req.params.id, req.body.entity, req.params.commentId, req.body, req.user, req.permissionContext,
  ));
});

export const uiQaDeleteComment = catchAsync(async (req, res) => {
  res.json(await uiQaService.deleteUiQaComment(
    req.params.id, req.body.entity, req.params.commentId, req.user, req.permissionContext,
  ));
});

export const uiQaAddAttachments = (config) => catchAsync(async (req, res) => {
  res.json(await uiQaService.addUiQaAttachments(
    req.params.id,
    parseUiQaJsonField(req.body?.entity, 'entity'),
    req.files || [],
    config,
    req.user,
    req.permissionContext,
    { clientRef: req.body.clientRef || null },
  ));
});

export const uiQaRemoveAttachment = catchAsync(async (req, res) => {
  res.json(await uiQaService.removeUiQaAttachment(
    req.params.id, req.body.entity, req.params.attachmentId, req.user, req.permissionContext,
  ));
});

export const uiQaDownloadAttachment = (config) => catchAsync(async (req, res) => {
  const entity = parseUiQaJsonField(req.query?.entity, 'entity');
  const { url } = await uiQaService.downloadUiQaAttachment(
    req.params.id,
    entity,
    req.params.attachmentId,
    config,
    req.user,
    req.permissionContext,
  );
  res.json({ url });
});

export const teamMembers = catchAsync(async (req, res) => {
  res.json(await projectService.getProjectTeamMembers(req.params.id));
});

export const replaceTeamMembers = catchAsync(async (req, res) => {
  res.json(await projectService.setProjectTeamMembers(
    req.params.id, req.body.members, req.user, req.permissionContext,
  ));
});

export const clientTesters = catchAsync(async (req, res) => {
  res.json(await projectService.getProjectClientTesters(req.params.id));
});

export const replaceClientTesters = catchAsync(async (req, res) => {
  res.json(await projectService.setProjectClientTesters(
    req.user, req.params.id, req.body.userIds, req.permissionContext,
  ));
});
