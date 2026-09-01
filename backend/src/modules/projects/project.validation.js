import Joi from 'joi';
import { PROJECT_TEAM_ROLES, QA_STATUSES, SCREEN_STATUSES, SCREEN_TYPES } from '@pms/shared';

const objectId = Joi.string().hex().length(24);

const uiQaAttachmentItem = Joi.object({
  key: Joi.string().trim().required(),
  name: Joi.string().trim().required(),
  size: Joi.number().integer().min(0),
  mimeType: Joi.string().trim().allow('', null),
  uploadedBy: objectId,
  uploadedAt: Joi.date(),
  clientRef: Joi.string().trim().allow('', null),
});

const uiQaStatusHistoryItem = Joi.object({
  from: Joi.string().valid(...QA_STATUSES).allow(null),
  to: Joi.string().valid(...QA_STATUSES).required(),
  by: objectId,
  at: Joi.date(),
  note: Joi.string().trim().max(500).allow('', null),
});

const uiQaCommentItem = Joi.object({
  content: Joi.string().trim().min(1).max(5000),
  commentedBy: objectId,
  attachments: Joi.array().items(uiQaAttachmentItem).default([]),
  clientRef: Joi.string().trim().allow('', null),
  editedAt: Joi.date().allow(null),
});

const uiQaFields = {
  key: Joi.string().trim().max(80),
  qaStatus: Joi.string().valid(...QA_STATUSES),
  comments: Joi.array().items(uiQaCommentItem),
  attachments: Joi.array().items(uiQaAttachmentItem),
  qaStatusHistory: Joi.array().items(uiQaStatusHistoryItem),
};

const screenItem = Joi.object({
  ...uiQaFields,
  name: Joi.string().trim().min(1).max(120).required(),
  type: Joi.string().valid(...SCREEN_TYPES).default('other'),
  route: Joi.string().trim().max(200).allow('', null),
  status: Joi.string().valid(...SCREEN_STATUSES).default('active'),
  documentation: Joi.string().trim().max(2000).allow('', null),
});

const moduleItem = Joi.object({
  ...uiQaFields,
  label: Joi.string().trim().min(1).max(80).required(),
  pages: Joi.array().items(Joi.object({
    ...uiQaFields,
    label: Joi.string().trim().min(1).max(80).required(),
    path: Joi.string().trim().max(200).allow('', null),
    screens: Joi.array().items(screenItem).default([]),
  })).default([]),
});

const uiQaEntity = Joi.object({
  level: Joi.string().valid('module', 'page', 'screen').required(),
  moduleKey: Joi.string().trim().min(1).max(80).required(),
  pageKey: Joi.when('level', {
    is: Joi.valid('page', 'screen'),
    then: Joi.string().trim().min(1).max(80).required(),
    otherwise: Joi.forbidden(),
  }),
  screenKey: Joi.when('level', {
    is: 'screen',
    then: Joi.string().trim().min(1).max(80).required(),
    otherwise: Joi.forbidden(),
  }),
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

export const uiQaEntityQuerySchema = {
  params: Joi.object({ id: objectId.required() }),
  query: Joi.object({
    entity: Joi.string().custom((value, helpers) => {
      try {
        const parsed = JSON.parse(value);
        const { error, value: entity } = uiQaEntity.validate(parsed);
        if (error) return helpers.error('any.invalid');
        return entity;
      } catch {
        return helpers.error('any.invalid');
      }
    }).required(),
  }),
};

export const uiQaStatusSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    entity: uiQaEntity.required(),
    status: Joi.string().valid(...QA_STATUSES).required(),
    note: Joi.string().trim().max(500).allow('', null),
  }),
};

export const uiQaCommentSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    entity: uiQaEntity.required(),
    content: Joi.string().trim().min(1).max(5000).required(),
    clientRef: Joi.string().trim().max(120).allow('', null),
  }),
};

export const uiQaEditCommentSchema = {
  params: Joi.object({ id: objectId.required(), commentId: objectId.required() }),
  body: Joi.object({
    entity: uiQaEntity.required(),
    content: Joi.string().trim().min(1).max(5000).required(),
  }),
};

export const uiQaCommentIdSchema = {
  params: Joi.object({ id: objectId.required(), commentId: objectId.required() }),
  body: Joi.object({ entity: uiQaEntity.required() }),
};

export const uiQaAttachmentIdSchema = {
  params: Joi.object({ id: objectId.required(), attachmentId: objectId.required() }),
  query: Joi.object({ entity: Joi.string().required() }),
};

export const uiQaDeleteAttachmentSchema = {
  params: Joi.object({ id: objectId.required(), attachmentId: objectId.required() }),
  body: Joi.object({ entity: uiQaEntity.required() }),
};
