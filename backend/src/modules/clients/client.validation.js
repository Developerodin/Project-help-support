import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

export const listClientsSchema = {
  query: Joi.object({
    status: Joi.string().valid('active', 'archived'),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().max(80),
  }),
};

export const createClientSchema = {
  body: Joi.object({
    name: Joi.string().trim().min(1).max(120).required(),
    status: Joi.string().valid('active', 'archived'),
  }),
};

export const clientIdSchema = { params: Joi.object({ id: objectId.required() }) };

export const updateClientSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    name: Joi.string().trim().min(1).max(120),
    status: Joi.string().valid('active', 'archived'),
  }).min(1),
};
