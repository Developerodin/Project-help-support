import catchAsync from '../../platform/catchAsync.js';
import { ApiError } from '../../platform/errors.js';
import * as userService from './user.service.js';
import { createInvite, reissueInvite } from '../auth/auth.service.js';
import User from './user.model.js';
import { TransactionalEmailDeliveryError } from '../notifications/email.service.js';

function deliveryFailure(message, err) {
  const logId = err instanceof TransactionalEmailDeliveryError ? err.logId : null;
  const queued = logId ? ` It was queued for retry as ${logId}.` : '';
  return new ApiError(502, 'EMAIL_DELIVERY_FAILED', `${message}.${queued}`);
}

export const list = catchAsync(async (req, res) => {
  res.json(await userService.listUsers(req.user, req.query));
});

export const create = (deliverInvite) => catchAsync(async (req, res) => {
  const { user, inviteToken } = await createInvite(req.user, req.body);
  // The raw token leaves the process only through the deliverer. It is never in
  // the response body, where a proxy log or a screenshot would capture it.
  if (deliverInvite) {
    try {
      await deliverInvite(
        { user, inviteToken },
        { throwOnError: true, requestId: req.id },
      );
    } catch (err) {
      throw deliveryFailure('User was created but the invite email could not be delivered', err);
    }
  }
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
    if (deliverInvite) {
      try {
        await deliverInvite(
          { user, inviteToken },
          { throwOnError: true, requestId: req.id },
        );
      } catch (err) {
        throw deliveryFailure(
          'Invite token was reissued but the invite email could not be delivered',
          err,
        );
      }
    }
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

export const ticketPreferencesGet = catchAsync(async (req, res) => {
  res.json(await userService.getTicketPreferences(req.user));
});

export const ticketPreferencesUpdate = catchAsync(async (req, res) => {
  res.json(await userService.updateTicketPreferences(req.user, req.body));
});

export const ticketPreferencesReset = catchAsync(async (req, res) => {
  res.json(await userService.resetTicketPreferences(req.user));
});

export const remove = catchAsync(async (req, res) => {
  res.json(await userService.deleteUser(req.user, req.params.id));
});

export const reactivate = (deliverInvite) => catchAsync(async (req, res) => {
  const result = await userService.reactivateUser(req.user, req.params.id);
  let sent = false;
  if (result.inviteToken && deliverInvite) {
    try {
      await deliverInvite(
        { user: result.user, inviteToken: result.inviteToken },
        { throwOnError: true, requestId: req.id },
      );
      sent = true;
    } catch (err) {
      throw deliveryFailure(
        'User was reactivated but the setup email could not be delivered',
        err,
      );
    }
  }
  res.json({
    ...result.user,
    reactivation: { requiresPassword: result.requiresPassword, sent },
  });
});
