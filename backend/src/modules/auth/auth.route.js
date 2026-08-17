import express from 'express';
import { validate } from '../../platform/validate.js';
import { auth, requireRole } from '../../platform/auth.js';
import { sameOrigin } from '../../platform/sameOrigin.js';
import {
  loginLimiter, passwordResetLimiter, inviteAcceptLimiter, refreshLimiter,
} from '../../platform/rateLimit.js';
import * as controller from './auth.controller.js';
import {
  loginSchema, previewInviteSchema, acceptInviteSchema, forgotPasswordSchema, resetPasswordSchema,
} from './auth.validation.js';
import { IMPERSONATION_INITIATOR_ROLES } from '@pms/shared';
import { userIdSchema } from '../users/user.validation.js';

/**
 * @param {object} config
 * @param {(result: { user: object, resetToken: string }) => Promise<void>} [deliverReset]
 *        Injected so these routes work before the email module exists (Plan 4).
 */
export default function authRoutes(config, deliverReset) {
  const router = express.Router();
  const origin = sameOrigin(config);

  router.post('/login', loginLimiter, validate(loginSchema), controller.login(config));
  router.post('/refresh', refreshLimiter, origin, controller.refresh(config));
  router.post('/logout', origin, controller.logout(config));
  router.get('/me', auth(config), controller.me);

  router.post('/invite/preview', inviteAcceptLimiter, validate(previewInviteSchema), controller.previewInvite);
  router.post('/invite/accept', inviteAcceptLimiter, validate(acceptInviteSchema), controller.acceptInvite);
  router.post('/forgot-password', passwordResetLimiter, validate(forgotPasswordSchema),
    controller.forgotPassword(deliverReset));
  router.post('/reset-password', passwordResetLimiter, validate(resetPasswordSchema), controller.resetPassword);

  router.post('/impersonate/:id', auth(config), requireRole(...IMPERSONATION_INITIATOR_ROLES), validate(userIdSchema),
    controller.impersonate(config));
  router.post('/stop-impersonation', auth(config), origin, controller.stopImpersonation(config));

  return router;
}
