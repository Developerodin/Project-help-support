import { WEB_MODULE_TAXONOMY } from '@pms/shared';
import User from './modules/users/user.model.js';
import Client from './modules/clients/client.model.js';
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
    title: 'Welcome to PROWPLUS PMS',
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
  { key: 'WEB', companyName: 'Dharwin', name: 'Web App', status: 'active', modules: WEB_MODULE_TAXONOMY },
  { key: 'MOB', companyName: 'Dharwin', name: 'Mobile App', status: 'active', modules: [] },
  // Reserved AND archived: it exists only so a later import of legacy DEV-*
  // tickets has a project to belong to. Archived keeps it out of every form.
  {
    key: 'DEV',
    companyName: 'Legacy',
    name: 'Legacy Dev Tickets',
    status: 'archived',
    modules: [],
    description: 'Reserved for imported legacy tickets. Do not file new tickets here.',
  },
];

const DEFAULT_COMPANY_BY_KEY = Object.freeze({
  WEB: 'Dharwin',
  MOB: 'Dharwin',
  DEV: 'Legacy',
});

// The reserved list and the seed list cannot silently drift apart.
for (const key of RESERVED_PROJECT_KEYS) {
  if (!SEED_PROJECTS.some((p) => p.key === key)) {
    throw new Error(`Reserved project key ${key} has no seed definition`);
  }
}

async function findOrCreateClient(name, actorId, status = 'active') {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  let client = await Client.findOne({ name: trimmed, status: 'active' });
  if (!client) {
    client = await Client.create({ name: trimmed, status, createdBy: actorId });
  }
  return client;
}

/**
 * One Client per distinct legacy Project.brand, then wire Project.client.
 * Safe to run on every boot — only touches projects missing a client reference.
 */
export async function migrateBrandsToClients(actor) {
  const created = [];
  const linked = [];

  const brands = await Project.distinct('brand');
  for (const brandName of brands.filter(Boolean)) {
    const existing = await Client.findOne({ name: brandName, status: 'active' });
    const client = existing ?? await Client.create({
      name: brandName, status: 'active', createdBy: actor._id,
    });
    if (!existing) created.push(brandName);

    const result = await Project.updateMany(
      { brand: brandName, $or: [{ client: null }, { client: { $exists: false } }] },
      { $set: { client: client._id } },
    );
    if (result.modifiedCount) linked.push(`${brandName} (${result.modifiedCount})`);
  }

  const uncategorized = await findOrCreateClient('Uncategorized', actor._id);
  if (uncategorized) {
    const result = await Project.updateMany(
      { $or: [{ client: null }, { client: { $exists: false } }] },
      { $set: { client: uncategorized._id } },
    );
    if (result.modifiedCount) linked.push(`Uncategorized (${result.modifiedCount})`);
  }

  if (created.length) logger.info(`Seeded companies from brands: ${created.join(', ')}`);
  if (linked.length) logger.info(`Linked projects to companies: ${linked.join(', ')}`);
  return { created, linked };
}

export async function seedProjects(actor) {
  const created = [];
  const backfilled = [];
  const clientsCreated = [];
  const migration = await migrateBrandsToClients(actor);

  for (const definition of SEED_PROJECTS) {
    const client = await findOrCreateClient(definition.companyName, actor._id);
    if (!client) continue;

    if (await Project.exists({ key: definition.key })) continue;

    const { companyName: _companyName, ...projectFields } = definition;
    await Project.create({
      ...projectFields,
      client: client._id,
      createdBy: actor._id,
    });
    created.push(definition.key);
    if (!clientsCreated.includes(definition.companyName)) clientsCreated.push(definition.companyName);
  }

  // Existing installs created before company grouping: assign sensible defaults.
  for (const project of await Project.find({
    $or: [{ client: null }, { client: { $exists: false } }],
  })) {
    const companyName = DEFAULT_COMPANY_BY_KEY[project.key] ?? project.brand ?? 'Uncategorized';
    const client = await findOrCreateClient(companyName, actor._id);
    if (!client) continue;
    project.client = client._id;
    await project.save();
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
  if (clientsCreated.length) logger.info(`Seeded companies: ${clientsCreated.join(', ')}`);
  return { created, backfilled, clientsCreated, linked: migration.linked };
}
