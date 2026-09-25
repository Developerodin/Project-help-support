import express from 'express';
import Joi from 'joi';
import { auth } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import { unsubscribeLimiter } from '../../platform/rateLimit.js';
import { ApiError } from '../../platform/errors.js';
import * as controller from './notification.controller.js';
import { removeSubscription, saveSubscription } from './push.service.js';

const objectId = Joi.string().hex().length(24);

const listSchema = {
  query: Joi.object({
    unread: Joi.boolean(),
    forYou: Joi.boolean(),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    project: objectId,
  }),
};

const readAllSchema = {
  query: Joi.object({
    project: objectId,
    ticket: objectId,
  }),
};

const endpoint = Joi.string().uri({ scheme: ['https'] }).max(1000).required();

const subscribeSchema = {
  body: Joi.object({
    endpoint,
    // Browsers add expirationTime (usually null); nothing here reads it.
    expirationTime: Joi.any(),
    keys: Joi.object({
      p256dh: Joi.string().max(200).required(),
      auth: Joi.string().max(100).required(),
    }).required(),
  }),
};

const unsubscribeSchema = { body: Joi.object({ endpoint }) };

const idSchema = { params: Joi.object({ id: Joi.string().hex().length(24).required() }) };

const ticketSettingsSchema = { params: Joi.object({ ticketId: objectId.required() }) };
const saveTicketSettingsSchema = {
  params: Joi.object({ ticketId: objectId.required() }),
  body: Joi.object({ muted: Joi.boolean(), following: Joi.boolean() }).min(1),
};

// Mail providers POST `List-Unsubscribe=One-Click` as a form body; nothing reads it.
const emailTokenSchema = {
  query: Joi.object({ token: Joi.string().max(200).required() }),
  body: Joi.object().unknown(true),
};

export default function notificationRoutes(config) {
  const router = express.Router();

  // Unsubscribe links in ticket email, with no session: the signed token is
  // the credential. GET only reads (scanners prefetch links); POST is the
  // RFC 8058 one-click call a mail provider makes, and the frontend's button.
  router.get('/email/unsubscribe', unsubscribeLimiter, validate({ query: emailTokenSchema.query }),
    controller.emailStatus(config));
  router.post('/email/unsubscribe', unsubscribeLimiter, validate(emailTokenSchema),
    controller.emailPause(config, true));
  router.post('/email/resubscribe', unsubscribeLimiter, validate(emailTokenSchema),
    controller.emailPause(config, false));

  router.use(auth(config));

  // Web push. The public key is what a browser subscribes with; `enabled: false`
  // (keys not configured) hides the device toggle.
  router.get('/push', (_req, res) => {
    res.json(config.push ? { enabled: true, publicKey: config.push.publicKey } : { enabled: false });
  });
  router.post('/push/subscribe', validate(subscribeSchema), async (req, res, next) => {
    try {
      if (!config.push) throw new ApiError(503, 'PUSH_DISABLED', 'Push notifications are not configured.');
      // An admin's device must never start receiving the impersonated person's notifications.
      if (req.impersonation) throw new ApiError(403, 'PUSH_IMPERSONATING', 'Stop impersonating to turn on push.');
      await saveSubscription(req.user, req.body, req.get('user-agent'));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });
  router.post('/push/unsubscribe', validate(unsubscribeSchema), async (req, res, next) => {
    try {
      await removeSubscription(req.user, req.body.endpoint);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Mute / follow one ticket. :ticketId is the ticket's Mongo id.
  router.get('/ticket-settings/:ticketId', validate(ticketSettingsSchema), controller.ticketSettings);
  router.put('/ticket-settings/:ticketId', validate(saveTicketSettingsSchema), controller.saveTicketSettings);

  router.get('/', validate(listSchema), controller.list);
  router.post('/read-all', validate(readAllSchema), controller.readAll);
  router.patch('/:id/read', validate(idSchema), controller.read);

  return router;
}
