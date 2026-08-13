import User from './modules/users/user.model.js';
import Project, { RESERVED_PROJECT_KEYS } from './modules/projects/project.model.js';
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

  logger.info(`Seeded initial admin: ${admin.email}`);
  return { created: true };
}

/**
 * WEB's taxonomy is seeded once from what Dharwin's dev-ticket-modules.ts held.
 * MOB seeds EMPTY on purpose — no mobile taxonomy exists yet, and it is filled
 * through PUT /v1/projects/:id/modules once the screens are known.
 */
const WEB_MODULES = [
  { label: 'ATS', pages: [
    { label: 'Jobs', path: '/ats/jobs' },
    { label: 'Candidates', path: '/ats/candidates' },
    { label: 'Applications', path: '/ats/applications' },
    { label: 'Interviews', path: '/ats/interviews' },
    { label: 'Offers', path: '/ats/offers' },
  ] },
  { label: 'Employees', pages: [
    { label: 'Directory', path: '/employees' },
    { label: 'Profile', path: '/employees/profile' },
    { label: 'Onboarding', path: '/employees/onboarding' },
    { label: 'Offboarding', path: '/employees/offboarding' },
  ] },
  { label: 'Attendance', pages: [
    { label: 'Punches', path: '/attendance' },
    { label: 'Leave', path: '/attendance/leave' },
  ] },
  { label: 'Payroll', pages: [{ label: 'Runs', path: '/payroll' }] },
  { label: 'Task Board', pages: [
    { label: 'Board', path: '/tasks' },
    { label: 'Sprints', path: '/tasks/sprints' },
  ] },
  { label: 'Communication', pages: [
    { label: 'Dialer', path: '/communication/dialer' },
    { label: 'Meetings', path: '/communication/meetings' },
    { label: 'Chat', path: '/communication/chat' },
  ] },
  { label: 'Settings', pages: [
    { label: 'Roles', path: '/settings/roles' },
    { label: 'Organization', path: '/settings/organization' },
  ] },
];

const SEED_PROJECTS = [
  { key: 'WEB', name: 'Web App', status: 'active', modules: WEB_MODULES },
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

  for (const definition of SEED_PROJECTS) {
    if (await Project.exists({ key: definition.key })) continue;
    await Project.create({ ...definition, createdBy: actor._id });
    created.push(definition.key);
  }

  if (created.length) logger.info(`Seeded projects: ${created.join(', ')}`);
  return { created };
}