import catchAsync from '../../platform/catchAsync.js';
import * as notificationService from './notification.service.js';
import { getTicketSettings, updateTicketSettings } from './ticket-settings.service.js';
import { setEmailPaused, unsubscribeStatus } from './unsubscribe.js';

export const list = catchAsync(async (req, res) => {
  res.json(await notificationService.listNotifications(req.user, req.query));
});

export const read = catchAsync(async (req, res) => {
  res.json(await notificationService.markRead(req.user, req.params.id));
});

export const readAll = catchAsync(async (req, res) => {
  res.json(await notificationService.markAllRead(req.user, req.query));
});

export const ticketSettings = catchAsync(async (req, res) => {
  res.json(await getTicketSettings(req.user, req.params.ticketId));
});

export const saveTicketSettings = catchAsync(async (req, res) => {
  res.json(await updateTicketSettings(req.user, req.params.ticketId, req.body));
});

export const emailStatus = (config) => catchAsync(async (req, res) => {
  res.json(await unsubscribeStatus(req.query.token, config));
});

export const emailPause = (config, paused) => catchAsync(async (req, res) => {
  await setEmailPaused(req.query.token, config, paused);
  res.status(204).end();
});
