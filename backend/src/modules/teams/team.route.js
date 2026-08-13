import express from 'express';
import { auth, requireRole } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import * as controller from './team.controller.js';
import {
  listTeamsSchema, createTeamSchema, teamIdSchema, updateTeamSchema, updateMembersSchema,
} from './team.validation.js';

export default function teamRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', validate(listTeamsSchema), controller.list);
  router.post('/', requireRole('admin', 'lead'), validate(createTeamSchema), controller.create);
  router.get('/:id', validate(teamIdSchema), controller.get);
  router.patch('/:id', requireRole('admin', 'lead'), validate(updateTeamSchema), controller.update);
  router.patch('/:id/members', requireRole('admin', 'lead'),
    validate(updateMembersSchema), controller.members);

  return router;
}
