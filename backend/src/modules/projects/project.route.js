import express from 'express';
import { auth, requireRole } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import * as controller from './project.controller.js';
import {
  listProjectsSchema, createProjectSchema, projectIdSchema,
  updateProjectSchema, replaceModulesSchema,
} from './project.validation.js';

export default function projectRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', validate(listProjectsSchema), controller.list);
  router.get('/brands', controller.listBrands);
  router.post('/', requireRole('admin'), validate(createProjectSchema), controller.create);
  router.get('/:id', validate(projectIdSchema), controller.get);
  router.patch('/:id', requireRole('admin'), validate(updateProjectSchema), controller.update);
  router.put('/:id/modules', requireRole('admin'),
    validate(replaceModulesSchema), controller.modules);

  return router;
}
