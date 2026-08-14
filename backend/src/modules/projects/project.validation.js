import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

const moduleItem = Joi.object({
  label: Joi.string().trim().min(1).max(80).required(),
  pages: Joi.array().items(Joi.object({
    label: Joi.string().trim().min(1).max(80).required(),
    path: Joi.string().trim().max(200).allow('', null),
  })).default([]),
});

export const listProjectsSchema = {
  query: Joi.object({
    status: Joi.string().valid('active', 'archived'),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().max(80),
  }),
};

export const createProjectSchema = {
  body: Joi.object({
    brand: Joi.string().trim().min(1).max(80).required(),
    key: Joi.string().trim().uppercase().pattern(/^[A-Z][A-Z0-9]{1,9}$/),
    name: Joi.string().trim().min(1).max(120).required(),
    description: Joi.string().trim().max(1000).allow(''),
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
    brand: Joi.string().trim().min(1).max(80),
    name: Joi.string().trim().min(1).max(120),
    description: Joi.string().trim().max(1000).allow(''),
    status: Joi.string().valid('active', 'archived'),
    defaultAssignee: objectId.allow(null),
    defaultTester: objectId.allow(null),
    defaultTeam: objectId.allow(null),
  }).min(1),
};

export const replaceModulesSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({ modules: Joi.array().items(moduleItem).required() }),
};
