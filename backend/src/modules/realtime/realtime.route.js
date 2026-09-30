import express from 'express';
import { ApiError } from '../../platform/errors.js';
import User from '../users/user.model.js';
import { verifyAccessToken } from '../auth/token.service.js';
import { loadPermissionContextForUser, createDenyByDefaultPermissionContext } from '../rbac/rbac.service.js';
import logger from '../../platform/logger.js';
import * as hub from './realtime-hub.js';
import { resolveAuthorizedProjectScope } from './realtime.service.js';

async function authenticateSse(req, config) {
  const header = req.headers?.authorization;
  const queryToken = typeof req.query?.access_token === 'string'
    ? req.query.access_token.trim()
    : '';
  const raw = header?.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : queryToken;
  if (!raw) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');

  let payload;
  try {
    payload = verifyAccessToken(raw, config);
  } catch {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  }

  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'active') {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  }

  try {
    req.permissionContext = await loadPermissionContextForUser(user._id);
  } catch (err) {
    logger.error('rbac.permission_context_load_failed', {
      userId: String(user._id),
      error: err.message,
    });
    req.permissionContext = createDenyByDefaultPermissionContext();
  }

  req.user = user;
}

// ponytail: both caps are per process (the hub is in-process); a
// multi-instance deploy multiplies them.
export const MAX_STREAMS_PER_USER = 10;
export const MAX_STREAMS_TOTAL = 2000;
/** How often an open stream re-checks that its user is still active. */
export const SSE_RECHECK_MS = 5 * 60 * 1000;

/** False once the user is deactivated or deleted; the stream should end. */
export async function streamUserStillActive(userId) {
  const user = await User.findById(userId).select('status').lean();
  return Boolean(user && user.status === 'active');
}

export default function realtimeRoutes(config) {
  const router = express.Router();

  router.get('/stream', async (req, res, next) => {
    // Registered before any await: a client that disconnects mid-auth must not
    // leave a subscriber or a heartbeat behind once the awaits resolve.
    let closed = false;
    let client = null;
    let heartbeat = null;
    const cleanup = () => {
      closed = true;
      clearInterval(heartbeat);
      if (client) hub.unsubscribe(client);
    };
    req.on('close', cleanup);
    res.on('close', cleanup);

    try {
      if (config.realtime?.enabled === false) {
        throw new ApiError(503, 'REALTIME_DISABLED', 'Live updates are disabled');
      }
      await authenticateSse(req, config);
      const projectId = await resolveAuthorizedProjectScope(
        req.user, req.query?.project, req.permissionContext,
      );
      if (closed) return;

      // Checked after the last await so the count cannot change before subscribe.
      const userId = String(req.user._id);
      if (hub.clientCount() >= MAX_STREAMS_TOTAL || hub.userClientCount(userId) >= MAX_STREAMS_PER_USER) {
        throw new ApiError(429, 'TOO_MANY_STREAMS', 'Too many live update connections');
      }

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      // compression() treats text/* as compressible and buffers writes until its
      // 1KB threshold — which an 80-byte SSE frame never reaches. An explicit
      // Content-Encoding makes it pass the response through untouched.
      res.setHeader('Content-Encoding', 'identity');
      // Same problem one layer out: nginx buffers proxied responses by default.
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      client = { res, userId, projectId };
      hub.subscribe(client);

      res.write(': connected\n\n');

      // A deactivated user must not keep receiving events on a stream opened
      // while they were active, so every few minutes a heartbeat re-checks.
      // ponytail: the access token's own expiry is not enforced here. The
      // browser's EventSource reconnects with the same URL (and so the same
      // token), so ending at expiry would drop the page to polling for good;
      // add it once use-ticket-realtime rebuilds the URL with a fresh token.
      const heartbeatMs = config.realtime?.sseHeartbeatMs ?? 25_000;
      let lastCheck = Date.now();
      let checking = false;
      heartbeat = setInterval(() => {
        if (res.writableEnded) return;
        res.write(': heartbeat\n\n');
        if (checking || Date.now() - lastCheck < SSE_RECHECK_MS) return;
        checking = true;
        lastCheck = Date.now();
        streamUserStillActive(userId)
          .then((active) => {
            if (!active && !res.writableEnded) res.end();
          })
          .catch((err) => {
            // A DB blip keeps the stream; the next check tries again.
            logger.warn('realtime.stream_recheck_failed', { userId, error: err.message });
          })
          .finally(() => { checking = false; });
      }, heartbeatMs);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
