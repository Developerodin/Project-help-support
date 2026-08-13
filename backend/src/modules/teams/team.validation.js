import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

export const listTeamsSchema = {
  query: Joi.object({
    project: objectId,
    status: Joi.string().valid('active', 'archived'),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().max(80),
  }),
};

export const createTeamSchema = {
  body: Joi.object({
    name: Joi.string().trim().min(1).max(120).required(),
    project: objectId.allow(null),
    lead: objectId.allow(null),
    members: Joi.array().items(objectId).default([]),
  }),
};

export const teamIdSchema = { params: Joi.object({ id: objectId.required() }) };

export const updateTeamSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    name: Joi.string().trim().min(1).max(120),
    project: objectId.allow(null),
    lead: objectId.allow(null),
    status: Joi.string().valid('active', 'archived'),
  }).min(1),
};

export const updateMembersSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    add: Joi.array().items(objectId).default([]),
    remove: Joi.array().items(objectId).default([]),
  }).min(1),
};
