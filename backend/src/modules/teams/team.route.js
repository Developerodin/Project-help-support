import express from 'express';
import { auth, requireRole } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import { PROJECT_ADMIN_ROLES } from '@pms/shared';
import * as controller from './team.controller.js';
import {
  listTeamsSchema, createTeamSchema, teamIdSchema, updateTeamSchema, updateMembersSchema,
} from './team.validation.js';

export default function teamRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', validate(listTeamsSchema), controller.list);
  router.post('/', requireRole(...PROJECT_ADMIN_ROLES), validate(createTeamSchema), controller.create);
  router.get('/:id', validate(teamIdSchema), controller.get);
  router.patch('/:id', requireRole(...PROJECT_ADMIN_ROLES), validate(updateTeamSchema), controller.update);
  router.patch('/:id/members', requireRole(...PROJECT_ADMIN_ROLES),
    validate(updateMembersSchema), controller.members);

  return router;
}
