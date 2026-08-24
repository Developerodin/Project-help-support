import catchAsync from '../../platform/catchAsync.js';
import * as clientService from './client.service.js';

export const list = (config) => catchAsync(async (req, res) => {
  res.json(await clientService.listClients(req.query, config, req.user, req.permissionContext));
});

export const create = (config) => catchAsync(async (req, res) => {
  res.status(201).json(
    await clientService.createClient(req.user, req.body, config, req.permissionContext),
  );
});

export const get = (config) => catchAsync(async (req, res) => {
  res.json(await clientService.getClient(req.params.id, config, req.user, req.permissionContext));
});

export const update = (config) => catchAsync(async (req, res) => {
  res.json(await clientService.updateClient(
    req.user, req.params.id, req.body, config, req.permissionContext,
  ));
});

export const uploadLogo = (config) => catchAsync(async (req, res) => {
  res.json(await clientService.uploadClientLogo(
    req.params.id, req.file, req.user, config,
  ));
});

export const removeLogo = (config) => catchAsync(async (req, res) => {
  res.json(await clientService.removeClientLogo(req.params.id, config));
});
