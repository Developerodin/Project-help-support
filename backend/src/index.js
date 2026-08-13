import 'dotenv/config';
import { loadConfig } from './platform/config.js';
import { connectDb } from './platform/db.js';
import { createApp } from './app.js';
import { seedAdmin, seedProjects } from './seed.js';
import User from './modules/users/user.model.js';
import { buildInviteDeliverer, buildResetDeliverer } from './modules/notifications/dispatch.js';
import logger from './platform/logger.js';

async function start() {
  const config = loadConfig(process.env);

  if (!config.features.email) logger.warn('Email capability disabled — SMTP group not configured');
  if (!config.features.attachments) logger.warn('Attachment capability disabled — storage group not configured');

  await connectDb(config.mongoUrl);
  await seedAdmin(config);
  // The oldest admin owns the seeded projects; createdBy is required on Project.
  const seedActor = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });
  if (seedActor) await seedProjects(seedActor);

  const app = createApp(config, {
    deliverInvite: buildInviteDeliverer(config),
    deliverReset: buildResetDeliverer(config),
  });

  app.listen(config.port, () => {
    logger.info(`API listening on :${config.port} (${config.nodeEnv})`);
  });
}

start().catch((err) => {
  logger.error(`Startup failed: ${err.message}`, { stack: err.stack });
  process.exit(1);
});