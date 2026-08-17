import catchAsync from '../../platform/catchAsync.js';
import * as projectService from './project.service.js';

export const list = catchAsync(async (req, res) => {
  res.json(await projectService.listProjects(req.query));
});

export const listBrands = catchAsync(async (_req, res) => {
  res.json(await projectService.listBrands());
});

export const create = catchAsync(async (req, res) => {
  res.status(201).json(await projectService.createProject(req.user, req.body));
});

export const get = catchAsync(async (req, res) => {
  res.json(await projectService.getProject(req.params.id));
});

export const update = catchAsync(async (req, res) => {
  res.json(await projectService.updateProject(req.params.id, req.body));
});

export const modules = catchAsync(async (req, res) => {
  res.json(await projectService.replaceModules(req.params.id, req.body.modules));
});

export const teamMembers = catchAsync(async (req, res) => {
  res.json(await projectService.getProjectTeamMembers(req.params.id));
});

export const replaceTeamMembers = catchAsync(async (req, res) => {
  res.json(await projectService.setProjectTeamMembers(req.params.id, req.body.members));
});
