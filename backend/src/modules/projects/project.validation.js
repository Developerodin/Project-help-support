import Joi from 'joi';
import { PROJECT_TEAM_ROLES, SCREEN_STATUSES, SCREEN_TYPES } from '@pms/shared';

const objectId = Joi.string().hex().length(24);

const screenItem = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  type: Joi.string().valid(...SCREEN_TYPES).default('other'),
  route: Joi.string().trim().max(200).allow('', null),
  status: Joi.string().valid(...SCREEN_STATUSES).default('active'),
  documentation: Joi.string().trim().max(2000).allow('', null),
});

const moduleItem = Joi.object({
  label: Joi.string().trim().min(1).max(80).required(),
  pages: Joi.array().items(Joi.object({
    label: Joi.string().trim().min(1).max(80).required(),
    path: Joi.string().trim().max(200).allow('', null),
    screens: Joi.array().items(screenItem).default([]),
  })).default([]),
});

export const listProjectsSchema = {
  query: Joi.object({
    status: Joi.string().valid('active', 'archived'),
    clientId: objectId,
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().max(80),
  }),
};

export const createProjectSchema = {
  body: Joi.object({
    clientId: objectId.required(),
    key: Joi.string().trim().uppercase().pattern(/^[A-Z][A-Z0-9]{1,9}$/),
    name: Joi.string().trim().min(1).max(120).required(),
    description: Joi.string().trim().max(1000).allow(''),
    team: objectId.allow(null),
    defaultAssignee: objectId.allow(null),
    defaultTester: objectId.allow(null),
    defaultTeam: objectId.allow(null),
    modules: Joi.array().items(moduleItem).default([]),
  }),
};

export const projectIdSchema = { params: Joi.object({ id: objectId.required() }) };

export const updateProjectSchema = {
  params: Joi.object({ id: objectId.required() }),
  // `key` is explicitly forbidden rather than merely absent, so an attempt to
  // change it returns a clear message instead of a generic unknown-key error.
  body: Joi.object({
    key: Joi.any().forbidden().messages({ 'any.unknown': 'Project key cannot be changed' }),
    name: Joi.string().trim().min(1).max(120),
    description: Joi.string().trim().max(1000).allow(''),
    status: Joi.string().valid('active', 'archived'),
    team: objectId.allow(null),
    defaultAssignee: objectId.allow(null),
    defaultTester: objectId.allow(null),
    defaultTeam: objectId.allow(null),
  }).min(1),
};

export const replaceModulesSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({ modules: Joi.array().items(moduleItem).required() }),
};

export const projectTeamMembersSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    members: Joi.array().items(Joi.object({
      userId: objectId.required(),
      role: Joi.string().valid(...PROJECT_TEAM_ROLES).required(),
    })).required(),
  }),
};

export const replaceClientTestersSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    userIds: Joi.array().items(objectId).default([]),
  }),
};
