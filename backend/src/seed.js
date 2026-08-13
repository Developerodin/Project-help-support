import { WEB_MODULE_TAXONOMY } from '@pms/shared';
import User from './modules/users/user.model.js';
import Project, { RESERVED_PROJECT_KEYS } from './modules/projects/project.model.js';
import Notification from './modules/notifications/notification.model.js';
import logger from './platform/logger.js';

/**
 * First boot only. The `seed` capability group is optional in general but
 * REQUIRED when the users collection is empty — otherwise the product starts
 * with no admin and no route to create one.
 */
export async function seedAdmin(config) {
  const userCount = await User.estimatedDocumentCount();

  if (userCount > 0) {
    return { created: false, reason: 'users already exist' };
  }

  if (!config.features.seed) {
    throw new Error(
      'Config error: the users collection is empty, so SEED_ADMIN_EMAIL and '
      + 'SEED_ADMIN_PASSWORD are required on first boot. Without them there is '
      + 'no way to log in.',
    );
  }

  const admin = await User.create({
    name: 'Administrator',
    email: config.seed.adminEmail,
    password: config.seed.adminPassword,
    role: 'admin',
    status: 'active',
  });

  await Notification.create({
    user: admin._id,
    event: 'TICKET_CREATED',
    title: 'Welcome to Dharwin Project Management Portal',
    body: 'Your inbox will show ticket updates here. Assign a ticket to yourself to test notifications.',
    link: `${config.frontendBaseUrl}/tickets`,
  });

  logger.info(`Seeded initial admin: ${admin.email}`);
  return { created: true };
}

/**
 * WEB's taxonomy is seeded from Dharwin Help & Support dev-ticket-modules.ts.
 * MOB seeds EMPTY on purpose — no mobile taxonomy exists yet, and it is filled
 * through PUT /v1/projects/:id/modules once the screens are known.
 */
const SEED_PROJECTS = [
  { key: 'WEB', name: 'Web App', status: 'active', modules: WEB_MODULE_TAXONOMY },
  { key: 'MOB', name: 'Mobile App', status: 'active', modules: [] },
  // Reserved AND archived: it exists only so a later import of legacy DEV-*
  // tickets has a project to belong to. Archived keeps it out of every form.
  {
    key: 'DEV',
    name: 'Legacy Dev Tickets',
    status: 'archived',
    modules: [],
    description: 'Reserved for imported legacy tickets. Do not file new tickets here.',
  },
];

// The reserved list and the seed list cannot silently drift apart.
for (const key of RESERVED_PROJECT_KEYS) {
  if (!SEED_PROJECTS.some((p) => p.key === key)) {
    throw new Error(`Reserved project key ${key} has no seed definition`);
  }
}

export async function seedProjects(actor) {
  const created = [];
  const backfilled = [];

  for (const definition of SEED_PROJECTS) {
    if (await Project.exists({ key: definition.key })) continue;
    await Project.create({ ...definition, createdBy: actor._id });
    created.push(definition.key);
  }

  // Existing installs may have WEB with an empty modules array (seed skipped
  // on re-boot, or created before taxonomy was wired). Backfill once.
  const web = await Project.findOne({ key: 'WEB' });
  if (web && web.modules.length === 0) {
    web.modules = WEB_MODULE_TAXONOMY;
    await web.save();
    backfilled.push('WEB');
  }

  if (created.length) logger.info(`Seeded projects: ${created.join(', ')}`);
  if (backfilled.length) logger.info(`Backfilled project modules: ${backfilled.join(', ')}`);
  return { created, backfilled };
}
