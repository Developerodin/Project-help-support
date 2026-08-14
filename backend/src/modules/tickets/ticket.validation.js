import Joi from 'joi';
import {
  CATEGORIES, ENVIRONMENTS, LABELS, SEVERITIES, PRIORITIES, STAGE_KEYS,
} from '@pms/shared';

const objectId = Joi.string().hex().length(24);
/** :id is either a Mongo id or a human ticketId — both forms, every route. */
const ticketRef = Joi.string().trim().min(1).max(64);
const revision = Joi.number().integer().min(0).required();

export const listTicketsSchema = {
  query: Joi.object({
    project: objectId,
    status: Joi.string().valid(...STAGE_KEYS),
    priority: Joi.string().valid(...PRIORITIES),
    severity: Joi.string().valid(...SEVERITIES),
    label: Joi.string().valid(...LABELS),
    module: Joi.string().trim().max(80),
    assignedTo: objectId,
    team: objectId,
    q: Joi.string().trim().max(200),
    scope: Joi.string().valid('all', 'assigned', 'reported', 'unassigned'),
    blocked: Joi.boolean().truthy('true').falsy('false'),
    overdue: Joi.boolean().truthy('true').falsy('false'),
    reopened: Joi.boolean().truthy('true').falsy('false'),
    sortBy: Joi.string().max(80),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
  }),
};

export const setBlockedSchema = {
  params: Joi.object({ id: ticketRef.required() }),
  body: Joi.object({
    revision,
    reason: Joi.string().trim().min(1).max(2000).required(),
  }),
};

export const clearBlockedSchema = {
  params: Joi.object({ id: ticketRef.required() }),
  body: Joi.object({ revision }),
};

export const createTicketSchema = {
  body: Joi.object({
    project: objectId.required(),
    title: Joi.string().trim().min(5).max(200).required().messages({
      'string.min': 'Title must be at least 5 characters long',
    }),
    description: Joi.string().trim().min(10).max(5000).required().messages({
      'string.min': 'Description must be at least 10 characters long',
    }),
    stepsToReproduce: Joi.string().trim().max(5000).allow('', null),
    module: Joi.string().trim().max(100).allow('', null),
    page: Joi.string().trim().max(100).allow('', null),
    category: Joi.string().valid(...CATEGORIES).default('Bug'),
    labels: Joi.array().items(Joi.string().valid(...LABELS)).default([]),
    severity: Joi.string().valid(...SEVERITIES).default('Major'),
    priority: Joi.string().valid(...PRIORITIES).default('Medium'),
    environment: Joi.string().valid(...ENVIRONMENTS).default('Staging'),
    assignedTo: objectId,
    testedBy: objectId,
    team: objectId,
    watchers: Joi.array().items(objectId).default([]),
  }),
};

export const ticketIdSchema = { params: Joi.object({ id: ticketRef.required() }) };

export const patchTicketSchema = {
  params: Joi.object({ id: ticketRef.required() }),
  body: Joi.object({
    revision,
    // REJECTED, not ignored. Every stage change goes through /transition, which
    // runs canTransition, the guards, the history write and the fan-out. A PATCH
    // that accepted status would be a documented bypass of the whole machine.
    status: Joi.any().forbidden().messages({
      'any.unknown': 'Use POST /v1/tickets/:id/transition to change the stage',
    }),
    createdBy: Joi.any().forbidden(),
    title: Joi.string().trim().min(5).max(200),
    description: Joi.string().trim().min(10).max(5000),
    stepsToReproduce: Joi.string().trim().max(5000).allow(null),
    module: Joi.string().trim().max(100).allow(null),
    page: Joi.string().trim().max(100).allow(null),
    environment: Joi.string().valid(...ENVIRONMENTS),
    category: Joi.string().valid(...CATEGORIES),
    labels: Joi.array().items(Joi.string().valid(...LABELS)),
    severity: Joi.string().valid(...SEVERITIES),
    priority: Joi.string().valid(...PRIORITIES),
    testedBy: objectId.allow(null),
    estimatedResolutionAt: Joi.date().iso().allow(null),
    expectedReleaseDate: Joi.date().iso().allow(null),
  }).min(2),
};

export const assignTicketSchema = {
  params: Joi.object({ id: ticketRef.required() }),
  body: Joi.object({
    revision,
    assignedTo: objectId.allow(null),
    team: objectId.allow(null),
  }).min(2),
};

export const bulkSchema = {
  body: Joi.object({
    action: Joi.string().valid('assign', 'delete').required(),
    ids: Joi.array().items(ticketRef).min(1).max(200).required(),
    assignedTo: objectId.allow(null),
    team: objectId.allow(null),
  }),
};

export const transitionSchema = {
  params: Joi.object({ id: ticketRef.required() }),
  body: Joi.object({
    to: Joi.string().valid(...STAGE_KEYS).required(),
    revision: Joi.number().integer().min(0).required(),
    // Which of these is MANDATORY derives from (from, to) in the service —
    // Joi cannot see the ticket's current stage, so it only bounds them here.
    note: Joi.string().trim().max(2000),
    reason: Joi.string().trim().max(2000),
  }),
};

export const addCommentSchema = {
  params: Joi.object({ id: ticketRef.required() }),
  body: Joi.object({
    content: Joi.string().trim().min(1).max(10000).required(),
    mentions: Joi.array().items(objectId).default([]),
    // Client-generated per submission. Its absence is allowed, but means a
    // retried request creates a second comment.
    clientRef: Joi.string().trim().max(64),
  }),
};

export const commentIdSchema = {
  params: Joi.object({ id: ticketRef.required(), commentId: objectId.required() }),
};

export const editCommentSchema = {
  params: Joi.object({ id: ticketRef.required(), commentId: objectId.required() }),
  body: Joi.object({ content: Joi.string().trim().min(1).max(10000).required() }),
};

export const reactionSchema = {
  params: Joi.object({ id: ticketRef.required(), commentId: objectId.required() }),
  body: Joi.object({ emoji: Joi.string().trim().min(1).max(16).required() }),
};

export const attachmentIdSchema = {
  params: Joi.object({ id: ticketRef.required(), attachmentId: objectId.required() }),
};

export const addAttachmentsSchema = {
  params: Joi.object({ id: ticketRef.required() }),
  body: Joi.object({
    clientRef: Joi.string().trim().max(64),
    commentId: objectId,
    commentContent: Joi.string().trim().min(1).max(10000),
    commentClientRef: Joi.string().trim().max(64),
  }).nand('commentId', 'commentContent'),
};