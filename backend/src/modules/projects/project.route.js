import express from 'express';
import { auth, requireRole } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import { ADMIN_ROLES } from '@pms/shared';
import * as controller from './project.controller.js';
import {
  listProjectsSchema, createProjectSchema, projectIdSchema,
  updateProjectSchema, replaceModulesSchema, projectTeamMembersSchema,
} from './project.validation.js';

export default function projectRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', validate(listProjectsSchema), controller.list);
  router.post('/', requireRole(...ADMIN_ROLES), validate(createProjectSchema), controller.create);
  router.get('/:id', validate(projectIdSchema), controller.get);
  router.patch('/:id', requireRole(...ADMIN_ROLES), validate(updateProjectSchema), controller.update);
  router.put('/:id/modules', requireRole(...ADMIN_ROLES),
    validate(replaceModulesSchema), controller.modules);
  router.get('/:id/team-members', validate(projectIdSchema), controller.teamMembers);
  router.put('/:id/team-members', requireRole(...ADMIN_ROLES),
    validate(projectTeamMembersSchema), controller.replaceTeamMembers);

  return router;
}
