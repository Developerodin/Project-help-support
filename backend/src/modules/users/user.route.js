import express from 'express';
import { auth, requireRole } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import { resendInviteLimiter } from '../../platform/rateLimit.js';
import * as controller from './user.controller.js';
import {
  listUsersSchema, createUserSchema, userIdSchema, updateUserSchema, notificationPrefsSchema,
} from './user.validation.js';

export default function userRoutes(config, deliverInvite) {
  const router = express.Router();
  router.use(auth(config));

  // Before /:id, or "me" is parsed as a user id.
  router.patch('/me/notification-prefs',
    validate(notificationPrefsSchema), controller.notificationPrefs);

  router.get('/', requireRole('admin'), validate(listUsersSchema), controller.list);
  router.post('/', requireRole('admin'), validate(createUserSchema),
    controller.create(deliverInvite));
  router.get('/:id', requireRole('admin'), validate(userIdSchema), controller.get);
  router.patch('/:id', requireRole('admin'), validate(updateUserSchema), controller.update);
  router.post('/:id/resend-invite', requireRole('admin'), resendInviteLimiter,
    validate(userIdSchema), controller.resendInvite(deliverInvite));

  return router;
}
