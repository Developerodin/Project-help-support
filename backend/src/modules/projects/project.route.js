import express from 'express';
import { can, isExternalUser } from '@pms/shared';
import { auth, requirePermission } from '../../platform/auth.js';
import { ApiError } from '../../platform/errors.js';
import { validate } from '../../platform/validate.js';
import * as controller from './project.controller.js';
import {
  listProjectsSchema, createProjectSchema, projectIdSchema,
  updateProjectSchema, replaceModulesSchema, projectTeamMembersSchema,
  replaceClientTestersSchema,
} from './project.validation.js';

function requireProjectView(req, _res, next) {
  if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
  if (isExternalUser(req.user)) return next();
  if (!can(req.user, 'clients.view', req.permissionContext)
    || !can(req.user, 'projects.view', req.permissionContext)) {
    return next(new ApiError(403, 'FORBIDDEN', 'Requires permissions: clients.view and projects.view'));
  }
  return next();
}

export default function projectRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', requireProjectView, validate(listProjectsSchema), controller.list);
  router.post('/', requirePermission('projects.manage'), validate(createProjectSchema), controller.create);
  router.get('/:id', requireProjectView, validate(projectIdSchema), controller.get);
  router.patch('/:id', requirePermission('projects.manage'), validate(updateProjectSchema), controller.update);
  router.put('/:id/modules', requirePermission('projects.manage'),
    validate(replaceModulesSchema), controller.modules);
  router.get('/:id/team-members', validate(projectIdSchema), controller.teamMembers);
  router.get('/:id/client-testers', validate(projectIdSchema), controller.clientTesters);
  router.put('/:id/client-testers', requirePermission('projects.manage'),
    validate(replaceClientTestersSchema), controller.replaceClientTesters);
  router.put('/:id/team-members', requirePermission('projects.manage'),
    validate(projectTeamMembersSchema), controller.replaceTeamMembers);

  return router;
}
