import crypto from 'node:crypto';
import express from 'express';
import { can } from '@pms/shared';
import { auth } from '../../platform/auth.js';
import { ApiError } from '../../platform/errors.js';
import logger from '../../platform/logger.js';
import {
  REPLIES, answer, getBusinessNumber, linkStatus, send, startLink, unlink,
} from './whatsapp.service.js';

function safeEqual(a, b) {
  if (typeof a !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Who sent a message: the phone number, plus Meta's user id when it sends one. */
function senderOf(value, message) {
  const contact = (value.contacts ?? []).find((c) => c.wa_id === message.from) ?? value.contacts?.[0];
  return { waId: message.from ?? contact?.wa_id, bsuid: contact?.user_id };
}

/** Answers one message. Runs after Meta has its 200, so failures are logged, not returned. */
async function handle(config, value, message) {
  const sender = senderOf(value, message);
  if (!sender.waId) return;
  let reply;
  try {
    reply = await answer(config, sender, message);
  } catch (err) {
    logger.error('whatsapp message failed', { id: message.id, error: err.message, stack: err.stack });
    reply = REPLIES.failed;
  }
  if (reply) await send(config, sender.waId, reply);
}

/**
 * Meta's WhatsApp Cloud API webhook. Mounted before express.json: the
 * X-Hub-Signature-256 HMAC is over the exact bytes Meta sent.
 */
export default function whatsappWebhookRoutes(config) {
  const { verifyToken, appSecret } = config.whatsapp;
  const router = express.Router();

  // Meta calls this once when "Verify and save" is clicked.
  router.get('/webhook', (req, res) => {
    const ok = req.query['hub.mode'] === 'subscribe'
      && safeEqual(req.query['hub.verify_token'], verifyToken);
    if (!ok) return res.sendStatus(403);
    return res.type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
  });

  router.post('/webhook', express.raw({ type: 'application/json', limit: '1mb' }), (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(body).digest('hex')}`;
    if (!safeEqual(req.get('x-hub-signature-256'), expected)) return res.sendStatus(401);

    // Ack first: Meta retries anything slow or non-200 for up to 7 days.
    res.sendStatus(200);

    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      return logger.warn('whatsapp webhook: signed but not JSON');
    }
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        for (const m of value.messages ?? []) {
          logger.info('whatsapp message received', { id: m.id, type: m.type });
          // ponytail: in-process, not queued. A crash mid-answer loses that reply
          // (Meta already has its 200); a job queue would fix it if that matters.
          // Nothing awaits this, so an escaped rejection (Meta unreachable on send) would crash the process.
          handle(config, value, m).catch((err) => logger.error('whatsapp reply failed', { id: m.id, error: err.message }));
        }
        for (const s of value.statuses ?? []) {
          logger.info('whatsapp status', { id: s.id, status: s.status });
        }
      }
    }
    return undefined;
  });

  return router;
}

/** The signed-in user's own link, for the profile page. */
export function whatsappLinkRoutes(config) {
  const router = express.Router();
  // Scoped to /link, so /webhook with WhatsApp unconfigured is a plain 404, not a 401.
  router.use('/link', auth(config));

  const allowed = (req) => Boolean(config.whatsapp && config.assistant) && can(req.user, 'assistant.use', req.permissionContext);

  router.get('/link', async (req, res, next) => {
    try {
      if (!allowed(req)) return res.json({ enabled: false });
      return res.json({ enabled: true, ...(await linkStatus(req.user)) });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/link', async (req, res, next) => {
    try {
      if (!allowed(req)) throw new ApiError(403, 'WHATSAPP_NOT_ALLOWED', 'WhatsApp isn\'t available for your account.');
      // A link outlives the session: impersonating must not leave the admin's phone on someone else's account.
      if (req.impersonation) throw new ApiError(403, 'WHATSAPP_IMPERSONATING', 'Stop impersonating to link WhatsApp.');
      const { code, expiresAt } = await startLink(req.user);
      return res.json({ code, expiresAt, businessNumber: await getBusinessNumber(config) });
    } catch (err) {
      return next(err);
    }
  });

  router.delete('/link', async (req, res, next) => {
    try {
      await unlink(req.user);
      return res.json({ linked: false });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
