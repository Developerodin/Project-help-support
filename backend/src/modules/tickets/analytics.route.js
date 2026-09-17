import express from 'express';
import Joi from 'joi';
import {
  CATEGORIES, ENVIRONMENTS, LABELS, SEVERITIES, PRIORITIES, STAGE_KEYS,
} from '@pms/shared';
import { auth } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import { requireAnalyticsAccess } from './analytics.access.js';
import * as controller from './analytics.controller.js';

const objectId = Joi.string().hex().length(24);

// The SAME filter surface as the ticket list, so a tile and a list agree.
const baseFilters = {
  project: objectId,
  status: Joi.string().valid(...STAGE_KEYS),
  severity: Joi.string().valid(...SEVERITIES),
  priority: Joi.string().valid(...PRIORITIES),
  category: Joi.string().valid(...CATEGORIES),
  label: Joi.string().valid(...LABELS),
  team: objectId,
  assignedTo: objectId,
  module: Joi.string().trim().max(80),
  environment: Joi.string().valid(...ENVIRONMENTS),
  scope: Joi.string().valid('all', 'assigned', 'reported', 'unassigned'),
  blocked: Joi.boolean().truthy('true').falsy('false'),
  overdue: Joi.boolean().truthy('true').falsy('false'),
  reopened: Joi.boolean().truthy('true').falsy('false'),
  q: Joi.string().trim().max(200),
};

const overviewSchema = { query: Joi.object(baseFilters) };
const trendSchema = {
  query: Joi.object({ ...baseFilters, groupBy: Joi.string().valid('day', 'week') }),
};
const deliverySchema = {
  query: Joi.object({
    ...baseFilters,
    groupBy: Joi.string().valid('day', 'week'),
    windowDays: Joi.number().integer().min(7).max(90),
  }),
};
const drillSchema = {
  query: Joi.object({
    ...baseFilters,
    dimension: Joi.string().valid(
      'severity',
      'module',
      'assignee',
      'team',
      'priority',
      'category',
      'environment',
      'label',
    ).required(),
  }),
};
const dashboardSchema = {
  query: Joi.object({
    ...baseFilters,
    trendGroupBy: Joi.string().valid('day', 'week'),
    deliveryGroupBy: Joi.string().valid('day', 'week'),
    windowDays: Joi.number().integer().min(7).max(90),
    dimension: Joi.string().valid(
      'severity',
      'module',
      'assignee',
      'team',
      'priority',
      'category',
      'environment',
      'label',
    ),
  }),
};

export default function analyticsRoutes(config) {
  const router = express.Router();
  router.use(auth(config));
  router.use(requireAnalyticsAccess);

  router.get('/dashboard', validate(dashboardSchema), controller.dashboard);
  router.get('/overview', validate(overviewSchema), controller.overview);
  router.get('/trend', validate(trendSchema), controller.trend);
  router.get('/delivery', validate(deliverySchema), controller.delivery);
  router.get('/time-in-stage', validate(overviewSchema), controller.timeInStage);
  router.get('/drill', validate(drillSchema), controller.drill);

  return router;
}
