import catchAsync from '../../platform/catchAsync.js';
import * as projectService from './project.service.js';

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
