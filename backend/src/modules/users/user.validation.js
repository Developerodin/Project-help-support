import Joi from 'joi';
import {
  ROLES, NOTIFICATION_EVENTS, ROLE_IDS, PEOPLE_ASSIGNABLE_ROLES, INTERNAL_ROLES, EXTERNAL_ROLES,
  TICKET_SORT_COLUMNS, TICKET_SCOPES, PRIORITIES, CATEGORIES, SEVERITIES, STAGE_KEYS, EMAIL_FREQUENCIES,
} from '@pms/shared';
import { isValidTimeZone } from '../notifications/delivery-schedule.js';

const objectId = Joi.string().hex().length(24);
// An unknown key is a 400 here, so a typo'd event never becomes a stored
// preference nobody can satisfy.
const eventFlags = Joi.object()
  .pattern(Joi.string().valid(...NOTIFICATION_EVENTS), Joi.boolean());

export const listUsersSchema = {
  query: Joi.object({
    role: Joi.string().valid(...ROLES),
    status: Joi.string().valid('invited', 'active', 'inactive', 'deleted'),
    q: Joi.string().trim().max(120),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    sortBy: Joi.string().max(80),
    includeSuperAdmins: Joi.boolean().truthy('true').falsy('false'),
  }),
};

// A single account is either fully internal (staff, permission bundles) or
// fully external (client, AccessAssignment-scoped) — never both. Checked here,
// once, so every schema below that accepts `roles` inherits the rule instead
// of re-deriving it. shared/stages.js also treats a mixed actor as internal
// (defense in depth), but this is the single point that should ever REJECT it.
function rejectMixedRoleTypes(value, helpers) {
  const hasInternal = value.some((role) => INTERNAL_ROLES.includes(role));
  const hasExternal = value.some((role) => EXTERNAL_ROLES.includes(role));
  if (hasInternal && hasExternal) {
    return helpers.message('Roles cannot mix internal and external types');
  }
  return value;
}

const rolesArray = Joi.array()
  .items(Joi.string())
  .min(1)
  .unique()
  .custom(rejectMixedRoleTypes, 'reject mixed internal/external roles');

export const createUserSchema = {
  body: Joi.object({
    email: Joi.string().trim().lowercase().email().required(),
    role: Joi.string().valid(...PEOPLE_ASSIGNABLE_ROLES),
    roles: rolesArray.items(Joi.string().valid(...PEOPLE_ASSIGNABLE_ROLES)),
  }).default({ roles: [ROLE_IDS.DEVELOPER] }),
};

export const userIdSchema = { params: Joi.object({ id: objectId.required() }) };

export const updateUserSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    name: Joi.string().trim().min(1).max(120),
    role: Joi.string().valid(...ROLES),
    roles: rolesArray.items(Joi.string().valid(...ROLES)),
    status: Joi.string().valid('invited', 'active', 'inactive'),
  }).min(1),
};

export const updateMeSchema = {
  body: Joi.object({
    name: Joi.string().trim().min(1).max(120).required(),
  }),
};

const clockTime = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm');

const timeZone = Joi.string().trim().max(64).custom((value, helpers) => (
  isValidTimeZone(value) ? value : helpers.message('"timeZone" must be an IANA time zone, e.g. Asia/Kolkata')
), 'IANA time zone');

export const notificationPrefsSchema = {
  body: Joi.object({
    email: eventFlags,
    inApp: eventFlags,
    emailFrequency: Joi.string().valid(...EMAIL_FREQUENCIES),
    timeZone,
    quietHours: Joi.object({
      enabled: Joi.boolean(),
      start: clockTime,
      end: clockTime,
      allowUrgent: Joi.boolean(),
    }).min(1),
    emailPaused: Joi.boolean(),
  }).min(1),
};

const ticketFilterPrefs = Joi.object({
  q: Joi.string().trim().max(200).allow(''),
  status: Joi.string().valid('', ...STAGE_KEYS),
  priority: Joi.string().valid('', ...PRIORITIES),
  category: Joi.string().valid('', ...CATEGORIES),
  severity: Joi.string().valid('', ...SEVERITIES),
  scope: Joi.string().valid(...TICKET_SCOPES),
  assignedTo: objectId.allow('', null),
  blocked: Joi.boolean(),
  overdue: Joi.boolean(),
  reopened: Joi.boolean(),
  newReply: Joi.boolean(),
});

const ticketSortPrefs = Joi.object({
  column: Joi.string().valid(...TICKET_SORT_COLUMNS, null),
  direction: Joi.string().valid('asc', 'desc', null),
});

export const ticketPreferencesSchema = {
  body: Joi.object({
    filters: ticketFilterPrefs,
    sort: ticketSortPrefs,
    boardMine: Joi.boolean(),
    limit: Joi.number().integer().min(1).max(100),
  }).min(1),
};
