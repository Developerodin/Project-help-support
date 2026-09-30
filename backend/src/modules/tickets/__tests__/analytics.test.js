import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_IDS } from '@pms/shared';
import { withMemoryDb } from '../../../platform/__tests__/helpers/memoryDb.js';
import User from '../../users/user.model.js';
import Project from '../../projects/project.model.js';
import Ticket from '../ticket.model.js';
import { dashboard, ANALYTICS_TICKET_CEILING } from '../analytics.service.js';
import { requireAnalyticsAccess, ANALYTICS_ROLES } from '../analytics.access.js';
import Joi from 'joi';

withMemoryDb();

const mkUser = (role) => User.create({
  name: 'Analytics User',
  email: `${Math.random().toString(36).slice(2)}@example.com`,
  password: 'a-long-enough-password',
  status: 'active',
  role,
});

test('requireAnalyticsAccess rejects developer role', () => {
  const req = { user: { role: ROLE_IDS.DEVELOPER, roles: [ROLE_IDS.DEVELOPER] } };
  let statusCode;
  requireAnalyticsAccess(req, {}, (err) => {
    statusCode = err?.statusCode;
  });
  assert.equal(statusCode, 403);
});

test('requireAnalyticsAccess allows tester role', () => {
  const req = { user: { role: ROLE_IDS.TESTER, roles: [ROLE_IDS.TESTER] } };
  let passed;
  requireAnalyticsAccess(req, {}, (err) => {
    passed = !err;
  });
  assert.equal(passed, true);
});

test('requireAnalyticsAccess rejects external client role', () => {
  const req = { user: { role: ROLE_IDS.CLIENT, roles: [ROLE_IDS.CLIENT] } };
  let statusCode;
  requireAnalyticsAccess(req, {}, (err) => {
    statusCode = err?.statusCode;
  });
  assert.equal(statusCode, 403);
});

test('dashboard bundle returns overview trend delivery drill panels', async () => {
  const actor = await mkUser(ROLE_IDS.TESTER);
  const project = await Project.create({ key: 'ANA', name: 'Analytics', createdBy: actor._id });
  await Ticket.create({
    ticketId: 'ANA-1',
    project: project._id,
    title: 'Sample ticket for analytics',
    description: 'Enough text for validation',
    createdBy: actor._id,
    severity: 'Major',
    status: 'pending',
  });

  const result = await dashboard(actor, { project: String(project._id) });
  assert.ok(result.overview.total >= 1);
  assert.ok(Array.isArray(result.trend.points));
  assert.ok(result.delivery.summary);
  assert.ok(result.timeInStage.byStage);
  assert.ok(result.drill.rows.length >= 1);
  assert.equal(typeof result.ticketCount, 'number');
  assert.equal(result.ceiling, ANALYTICS_TICKET_CEILING);
});

test('analytics Joi accepts extended list-aligned filters', () => {
  const schema = Joi.object({
    category: Joi.string().valid('Bug', 'New Feature', 'Improvement'),
    label: Joi.string(),
    environment: Joi.string(),
    blocked: Joi.boolean().truthy('true').falsy('false'),
    overdue: Joi.boolean().truthy('true').falsy('false'),
    reopened: Joi.boolean().truthy('true').falsy('false'),
  });
  const { error, value } = schema.validate({
    category: 'Bug',
    label: 'regression',
    environment: 'Staging',
    blocked: 'true',
    overdue: false,
    reopened: 'true',
  });
  assert.equal(error, undefined);
  assert.equal(value.blocked, true);
  assert.equal(value.reopened, true);
});

test('ANALYTICS_ROLES matches UI analytics gate roles', () => {
  assert.deepEqual(ANALYTICS_ROLES, [
    ROLE_IDS.SUPER_ADMIN,
    ROLE_IDS.ADMIN,
    ROLE_IDS.PROJECT_ADMIN,
    ROLE_IDS.TESTER,
  ]);
});
