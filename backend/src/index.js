import './platform/loadEnv.js';
import { readFileSync } from 'node:fs';
import https from 'node:https';
import { assertNodeEnvSet, loadConfig } from './platform/config.js';
import { connectDb, disconnectDb } from './platform/db.js';
import { createApp } from './app.js';
import { seedAdmin, seedProjects, runLegacyMigrations } from './seed.js';
import User from './modules/users/user.model.js';
import { buildInviteDeliverer, buildResetDeliverer } from './modules/notifications/dispatch.js';
import {
  backfillNotificationActivity,
  backfillNotificationProjects,
} from './modules/notifications/notification.service.js';
import logger from './platform/logger.js';
import { retryPendingAuditOutbox } from './modules/rbac/rbac-audit.js';
import {
  replayNotificationOutboxOnBoot,
  scheduleEmailBatchFlush,
  scheduleNotificationOutboxReplay,
} from './modules/notifications/retry.runtime.js';
import { closeAll as closeRealtimeStreams } from './modules/realtime/realtime-hub.js';

const AUDIT_REPLAY_INTERVAL_MS = 5 * 60 * 1000;
const AUDIT_REPLAY_LIMIT = 50;

async function replayAuditOutboxOnBoot() {
  try {
    const result = await retryPendingAuditOutbox({ limit: AUDIT_REPLAY_LIMIT });
    if (result.replayed > 0) {
      logger.info('rbac.audit_outbox_replay_boot', result);
    }
  } catch (err) {
    logger.error('rbac.audit_outbox_replay_boot_failed', {
      error: err.message,
      stack: err.stack,
    });
  }
}

/** Rows from before notifications carried `project`; a no-op once they all do. */
async function backfillNotificationProjectsOnBoot() {
  try {
    const updated = await backfillNotificationProjects();
    if (updated > 0) logger.info('notifications.project_backfill', { updated });
  } catch (err) {
    logger.error('notifications.project_backfill_failed', { error: err.message, stack: err.stack });
  }
}

/** Rows from before notifications carried `activityAt`; a no-op once they all do. */
async function backfillNotificationActivityOnBoot() {
  try {
    const updated = await backfillNotificationActivity();
    if (updated > 0) logger.info('notifications.activity_backfill', { updated });
  } catch (err) {
    logger.error('notifications.activity_backfill_failed', { error: err.message, stack: err.stack });
  }
}

function scheduleAuditOutboxReplay() {
  const handle = setInterval(async () => {
    try {
      const result = await retryPendingAuditOutbox({ limit: AUDIT_REPLAY_LIMIT });
      if (result.replayed > 0) {
        logger.info('rbac.audit_outbox_replay_interval', result);
      }
    } catch (err) {
      logger.error('rbac.audit_outbox_replay_interval_failed', {
        error: err.message,
        stack: err.stack,
      });
    }
  }, AUDIT_REPLAY_INTERVAL_MS);
  handle.unref();
  return () => clearInterval(handle);
}

const SHUTDOWN_TIMEOUT_MS = 10_000;

function registerShutdown(stopFns, server) {
  const runStop = () => {
    for (const stop of stopFns) {
      try {
        stop();
      } catch (err) {
        logger.error('runtime.stop_hook_failed', { error: err.message });
      }
    }
  };

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('runtime.shutdown_started', { signal });
    // Past this, something is holding the process open; exit anyway.
    setTimeout(() => {
      logger.error('runtime.shutdown_timed_out', { timeoutMs: SHUTDOWN_TIMEOUT_MS });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    runStop();
    try {
      // server.close() waits for open connections, and SSE streams never end on
      // their own, so end them first.
      const closed = server ? new Promise((resolve) => server.close(() => resolve())) : Promise.resolve();
      closeRealtimeStreams();
      await closed;
      await disconnectDb();
      logger.info('runtime.shutdown_complete', { signal });
      process.exit(0);
    } catch (err) {
      logger.error('runtime.shutdown_failed', { error: err.message, stack: err.stack });
      process.exit(1);
    }
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('beforeExit', runStop);
}

// A promise nobody awaited, or a throw outside any handler, leaves the process
// in an unknown state; log it and exit so the supervisor restarts a clean one.
process.on('unhandledRejection', (reason) => {
  logger.error('runtime.unhandled_rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.error('runtime.uncaught_exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

/**
 * Seeds, legacy migrations, backfills and outbox replays all write to the
 * database, so they run only where RUN_BACKGROUND_JOBS is on (production by
 * default). A dev box pointed at a shared database leaves them to the server.
 */
async function runBootJobs(config) {
  await backfillNotificationProjectsOnBoot();
  await backfillNotificationActivityOnBoot();
  await replayAuditOutboxOnBoot();
  await replayNotificationOutboxOnBoot(config);
  await seedAdmin(config);
  // The oldest admin owns the seeded projects; createdBy is required on Project.
  const seedActor = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  if (seedActor) {
    await seedProjects(seedActor);
    await runLegacyMigrations(seedActor);
  }
}

function scheduleBackgroundJobs(config) {
  return [
    scheduleAuditOutboxReplay(),
    scheduleNotificationOutboxReplay(config),
    scheduleEmailBatchFlush(config),
  ];
}

async function start() {
  assertNodeEnvSet(process.env);
  const config = loadConfig(process.env);

  if (!config.features.email) logger.warn('Email capability disabled — SMTP group not configured');
  if (!config.features.attachments) logger.warn('Attachment capability disabled — storage group not configured');
  if (!config.features.assistant) logger.warn('Assistant disabled — OPENAI_API_KEY not set');
  if (!config.features.push) logger.warn('Push notifications disabled — VAPID keys not set');

  await connectDb(config.mongoUrl);
  let stopFns = [];
  if (config.runBackgroundJobs) {
    await runBootJobs(config);
    stopFns = scheduleBackgroundJobs(config);
  } else {
    logger.warn(
      'Background jobs skipped (RUN_BACKGROUND_JOBS is off): no seeding, legacy migrations, '
      + 'backfills, outbox replays, retry sweeps or email batch flush in this process',
    );
  }

  const app = createApp(config, {
    deliverInvite: buildInviteDeliverer(config),
    deliverReset: buildResetDeliverer(config),
  });

  const server = config.https
    ? https.createServer({ key: readFileSync(config.https.keyFile), cert: readFileSync(config.https.certFile) }, app)
    : app;
  // app.listen returns the http.Server; https.Server.listen returns itself.
  const listener = server.listen(config.port, () => {
    logger.info(`API listening on ${config.https ? 'https' : 'http'} :${config.port} (${config.nodeEnv})`);
  });
  registerShutdown(stopFns, listener);
}

start().catch((err) => {
  logger.error(`Startup failed: ${err.message}`, { stack: err.stack });
  process.exit(1);
});
