import Joi from 'joi';
import { ROLES, NOTIFICATION_EVENTS } from '@pms/shared';

const objectId = Joi.string().hex().length(24);
// An unknown key is a 400 here, so a typo'd event never becomes a stored
// preference nobody can satisfy.
const eventFlags = Joi.object()
  .pattern(Joi.string().valid(...NOTIFICATION_EVENTS), Joi.boolean());

export const listUsersSchema = {
  query: Joi.object({
    role: Joi.string().valid(...ROLES),
    status: Joi.string().valid('invited', 'active', 'inactive'),
    q: Joi.string().trim().max(120),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().max(80),
  }),
};

export const createUserSchema = {
  body: Joi.object({
    name: Joi.string().trim().min(1).max(120).required(),
    email: Joi.string().trim().lowercase().email().required(),
    role: Joi.string().valid(...ROLES).default('member'),
  }),
};

export const userIdSchema = { params: Joi.object({ id: objectId.required() }) };

export const updateUserSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    name: Joi.string().trim().min(1).max(120),
    role: Joi.string().valid(...ROLES),
    status: Joi.string().valid('invited', 'active', 'inactive'),
  }).min(1),
};

export const notificationPrefsSchema = {
  body: Joi.object({ email: eventFlags, inApp: eventFlags }).min(1),
};
