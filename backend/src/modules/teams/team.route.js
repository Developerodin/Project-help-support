import express from 'express';
import { auth, requirePermission } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import * as controller from './team.controller.js';
import {
  listTeamsSchema, createTeamSchema, teamIdSchema, updateTeamSchema, updateMembersSchema,
} from './team.validation.js';

function requireTeamUpdatePermission(req, _res, next) {
  const body = req.body || {};
  const keys = Object.keys(body);
  const archiveOnly = keys.length === 1 && keys[0] === 'status' && body.status === 'archived';
  return requirePermission(archiveOnly ? 'teams.delete' : 'teams.edit')(req, _res, next);
}

export default function teamRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', requirePermission('teams.view'), validate(listTeamsSchema), controller.list);
  router.post('/', requirePermission('teams.create'), validate(createTeamSchema), controller.create);
  router.get('/:id', requirePermission('teams.view'), validate(teamIdSchema), controller.get);
  router.patch('/:id', requireTeamUpdatePermission, validate(updateTeamSchema), controller.update);
  router.patch('/:id/members', requirePermission('teams.edit'),
    validate(updateMembersSchema), controller.members);

  return router;
}
