import catchAsync from '../../platform/catchAsync.js';
import * as notificationService from './notification.service.js';

export const list = catchAsync(async (req, res) => {
  res.json(await notificationService.listNotifications(req.user, req.query));
});

export const read = catchAsync(async (req, res) => {
  res.json(await notificationService.markRead(req.user, req.params.id));
});

export const readAll = catchAsync(async (req, res) => {
  res.json(await notificationService.markAllRead(req.user));
});
