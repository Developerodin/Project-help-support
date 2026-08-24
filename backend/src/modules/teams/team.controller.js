import catchAsync from '../../platform/catchAsync.js';
import * as teamService from './team.service.js';

export const list = catchAsync(async (req, res) => {
  res.json(await teamService.listTeams(req.query, req.user, req.permissionContext));
});

export const create = catchAsync(async (req, res) => {
  // Actor comes from req.user, never from the body.
  res.status(201).json(await teamService.createTeam(req.user, req.body, req.permissionContext));
});

export const get = catchAsync(async (req, res) => {
  res.json(await teamService.getTeam(req.params.id, req.user, req.permissionContext));
});

export const update = catchAsync(async (req, res) => {
  res.json(await teamService.updateTeam(req.params.id, req.body, req.user, req.permissionContext));
});

export const members = catchAsync(async (req, res) => {
  res.json(await teamService.updateMembers(
    req.params.id, req.body, req.user, req.permissionContext,
  ));
});
