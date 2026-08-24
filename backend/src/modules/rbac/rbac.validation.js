import Joi from 'joi';
import {
  MATRIX_ROLES,
  OVERRIDE_EDITABLE_PERMISSIONS,
  PERMISSIONS,
  SCOPED_ASSIGNABLE_ROLES,
  ENVIRONMENTS,
  BOARD_KEYS,
  BOARD_CAPABILITIES,
} from '@pms/shared';

const objectId = Joi.string().hex().length(24);
const grantsShape = Joi.object().pattern(
  Joi.string().valid(...MATRIX_ROLES),
  Joi.array().items(Joi.string().valid(...PERMISSIONS)).required(),
);

const boardGrantsShape = Joi.object().pattern(
  Joi.string().valid(...MATRIX_ROLES),
  Joi.object().pattern(
    Joi.string().valid(...BOARD_KEYS),
    Joi.array().items(Joi.string().valid(...BOARD_CAPABILITIES)).required(),
  ).required(),
);

export const updateRoleMatrixSchema = {
  body: Joi.object({
    grants: grantsShape.required(),
    ifMatch: Joi.date().iso(),
  }),
};

export const updateBoardPermissionsSchema = {
  body: Joi.object({
    grants: boardGrantsShape.required(),
    ifMatch: Joi.date().iso(),
  }),
};

export const userIdSchema = {
  params: Joi.object({ userId: objectId.required() }),
};

export const updateUserOverridesSchema = {
  params: Joi.object({ userId: objectId.required() }),
  body: Joi.object({
    overrides: Joi.object().pattern(
      Joi.string().valid(...OVERRIDE_EDITABLE_PERMISSIONS),
      Joi.string().valid('allow', 'deny'),
    ).required(),
    ifMatch: Joi.date().iso(),
  }),
};

const scopedAssignmentBody = {
  role: Joi.string().valid(...SCOPED_ASSIGNABLE_ROLES).required(),
  clientId: objectId.allow(null),
  projectId: objectId.allow(null),
  environments: Joi.array().items(Joi.string().valid(...ENVIRONMENTS)).default([]),
  status: Joi.string().valid('active', 'suspended').default('active'),
  expiresAt: Joi.date().iso().allow(null),
  reason: Joi.string().trim().allow('', null),
};

export const createScopedAssignmentSchema = {
  params: Joi.object({ userId: objectId.required() }),
  body: Joi.object(scopedAssignmentBody),
};

export const updateScopedAssignmentSchema = {
  params: Joi.object({ assignmentId: objectId.required() }),
  body: Joi.object({
    role: Joi.string().valid(...SCOPED_ASSIGNABLE_ROLES),
    clientId: objectId.allow(null),
    projectId: objectId.allow(null),
    environments: Joi.array().items(Joi.string().valid(...ENVIRONMENTS)),
    status: Joi.string().valid('active', 'suspended'),
    expiresAt: Joi.date().iso().allow(null),
    reason: Joi.string().trim().allow('', null),
    ifMatch: Joi.date().iso(),
  }).min(1),
};

export const revokeScopedAssignmentSchema = {
  params: Joi.object({ assignmentId: objectId.required() }),
  body: Joi.object({
    reason: Joi.string().trim().required(),
    ifMatch: Joi.date().iso(),
  }),
};

export const listAuditLogSchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().trim(),
    category: Joi.string().valid('policy', 'access'),
    action: Joi.string().trim(),
    targetUserId: objectId,
  }),
};
