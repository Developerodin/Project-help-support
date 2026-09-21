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

export default function realtimeRoutes(config) {
  const router = express.Router();

  router.get('/stream', async (req, res, next) => {
    try {
      if (config.realtime?.enabled === false) {
        throw new ApiError(503, 'REALTIME_DISABLED', 'Live updates are disabled');
      }
      await authenticateSse(req, config);

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

      const client = {
        res,
        userId: String(req.user._id),
        projectId: await resolveAuthorizedProjectScope(
          req.user, req.query?.project, req.permissionContext,
        ),
      };
      hub.subscribe(client);

      res.write(': connected\n\n');

      const heartbeatMs = config.realtime?.sseHeartbeatMs ?? 25_000;
      const heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(': heartbeat\n\n');
      }, heartbeatMs);

      const cleanup = () => {
        clearInterval(heartbeat);
        hub.unsubscribe(client);
      };
      req.on('close', cleanup);
      res.on('close', cleanup);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
