import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import compression from 'compression';
import morgan from 'morgan';

import { requestId } from './platform/requestId.js';
import logger, { redactSensitiveQuery } from './platform/logger.js';
import { ApiError, errorConverter, errorHandler } from './platform/errors.js';
import { isDbReady } from './platform/db.js';
import { buildOriginMatcher } from './platform/origin-policy.js';
import authRoutes from './modules/auth/auth.route.js';
import teamRoutes from './modules/teams/team.route.js';
import clientRoutes from './modules/clients/client.route.js';
import projectRoutes from './modules/projects/project.route.js';
import ticketRoutes from './modules/tickets/ticket.route.js';
import userRoutes from './modules/users/user.route.js';
import notificationRoutes from './modules/notifications/notification.route.js';
import { setDefaultTimeZone } from './modules/notifications/delivery-schedule.js';
import assistantRoutes from './modules/assistant/assistant.route.js';
import analyticsRoutes from './modules/tickets/analytics.route.js';
import rbacRoutes from './modules/rbac/rbac.route.js';
import realtimeRoutes from './modules/realtime/realtime.route.js';
import whatsappWebhookRoutes, { whatsappLinkRoutes } from './modules/whatsapp/whatsapp.route.js';

export function createApp(config, { deliverReset, deliverInvite } = {}) {
  setDefaultTimeZone(config.defaultTimeZone);
  const app = express();
  const originAllowed = buildOriginMatcher(config);

  // FIRST. Every response — including 401 and 404 — must carry a request id,
  // which is only true if this precedes auth, validation and routing.
  app.use(requestId);

  // One hop (nginx): req.ip is the address nginx saw, not a client-supplied X-Forwarded-For.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      callback(null, originAllowed(origin));
    },
    credentials: true,
    exposedHeaders: ['Location'],
  }));
  // Before express.json: Meta signs the raw body.
  if (config.whatsapp) app.use('/v1/whatsapp', whatsappWebhookRoutes(config));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(mongoSanitize());
  app.use(compression());

  if (config.nodeEnv !== 'test') {
    morgan.token('safeUrl', (req) => redactSensitiveQuery(req.originalUrl || req.url));
    app.use(config.isProduction
      ? morgan(':method :safeUrl :status :response-time ms - reqId=:res[x-request-id]')
      // Locally, through the logger so request lines read like every other `info:` line.
      : morgan(':method :safeUrl :status :response-time[0]ms', {
        stream: { write: (line) => logger.info(line.trim()) },
      }));
  }

  // Liveness: is the process up. Readiness: can it actually serve. Without the
  // second, a process reports healthy while unable to answer a single request.
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/ready', (_req, res) => {
    const database = isDbReady();
    res.status(database ? 200 : 503).json({
      status: database ? 'ready' : 'not-ready',
      checks: { database },
    });
  });

  app.use('/v1', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/v1/auth', authRoutes(config, deliverReset));
  app.use('/v1/teams', teamRoutes(config));
  app.use('/v1/clients', clientRoutes(config));
  app.use('/v1/projects', projectRoutes(config));
  app.use('/v1/tickets', ticketRoutes(config));
  app.use('/v1/users', userRoutes(config, deliverInvite));
  app.use('/v1/notifications', notificationRoutes(config));
  app.use('/v1/analytics', analyticsRoutes(config));
  app.use('/v1/rbac', rbacRoutes(config));
  app.use('/v1/realtime', realtimeRoutes(config));
  app.use('/v1/assistant', assistantRoutes(config));
  app.use('/v1/whatsapp', whatsappLinkRoutes(config));

  app.use('/v1', (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Resource not found')));

  app.use(errorConverter);
  app.use(errorHandler(config));

  return app;
}