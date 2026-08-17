import catchAsync from '../../platform/catchAsync.js';
import * as userService from './user.service.js';
import { createInvite, reissueInvite } from '../auth/auth.service.js';
import User from './user.model.js';

export const list = catchAsync(async (req, res) => {
  res.json(await userService.listUsers(req.user, req.query));
});

export const create = (deliverInvite) => catchAsync(async (req, res) => {
  const { user, inviteToken } = await createInvite(req.user, req.body);
  // The raw token leaves the process only through the deliverer. It is never in
  // the response body, where a proxy log or a screenshot would capture it.
  if (deliverInvite) await deliverInvite({ user, inviteToken });
  res.status(201).json(user);
});

export const get = catchAsync(async (req, res) => {
  res.json(await userService.getUser(req.user, req.params.id));
});

export const update = catchAsync(async (req, res) => {
  res.json(await userService.updateUser(req.user, req.params.id, req.body));
});

export const resendInvite = (deliverInvite) => catchAsync(async (req, res) => {
  const target = await User.findById(req.params.id);
  let sent = false;

  if (target && target.status === 'invited') {
    const { user, inviteToken } = await reissueInvite(target._id);
    if (deliverInvite) await deliverInvite({ user, inviteToken });
    sent = true;
  }

  res.json({ status: 'ok', sent });
});

export const updateMe = catchAsync(async (req, res) => {
  res.json(await userService.updateMe(req.user, req.body));
});

export const notificationPrefs = catchAsync(async (req, res) => {
  res.json(await userService.updateNotificationPrefs(req.user, req.body));
});

export const remove = catchAsync(async (req, res) => {
  res.json(await userService.deleteUser(req.user, req.params.id));
});
