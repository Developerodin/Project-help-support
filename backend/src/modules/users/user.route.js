import express from 'express';
import { auth, requireRole } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import { resendInviteLimiter } from '../../platform/rateLimit.js';
import { ADMIN_ROLES } from '@pms/shared';
import * as controller from './user.controller.js';
import {
  listUsersSchema, createUserSchema, userIdSchema, updateUserSchema, updateMeSchema, notificationPrefsSchema,
} from './user.validation.js';

export default function userRoutes(config, deliverInvite) {
  const router = express.Router();
  router.use(auth(config));

  // Before /:id, or "me" is parsed as a user id.
  router.patch('/me', validate(updateMeSchema), controller.updateMe);
  router.patch('/me/notification-prefs',
    validate(notificationPrefsSchema), controller.notificationPrefs);

  router.get('/', requireRole(...ADMIN_ROLES), validate(listUsersSchema), controller.list);
  router.post('/', requireRole(...ADMIN_ROLES), validate(createUserSchema),
    controller.create(deliverInvite));
  router.get('/:id', requireRole(...ADMIN_ROLES), validate(userIdSchema), controller.get);
  router.patch('/:id', requireRole(...ADMIN_ROLES), validate(updateUserSchema), controller.update);
  router.delete('/:id', requireRole(...ADMIN_ROLES), validate(userIdSchema), controller.remove);
  router.post('/:id/resend-invite', requireRole(...ADMIN_ROLES), resendInviteLimiter,
    validate(userIdSchema), controller.resendInvite(deliverInvite));

  return router;
}
