import express from 'express';
import { auth, requirePermission } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import { logoUploadMiddleware } from '../../platform/upload.js';
import * as controller from './client.controller.js';
import {
  listClientsSchema, createClientSchema, clientIdSchema, updateClientSchema,
} from './client.validation.js';

export default function clientRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', requirePermission('clients.view'), validate(listClientsSchema), controller.list(config));
  router.post('/', requirePermission('clients.manage'), validate(createClientSchema), controller.create(config));
  router.get('/:id', requirePermission('clients.view'), validate(clientIdSchema), controller.get(config));
  router.patch('/:id', requirePermission('clients.manage'), validate(updateClientSchema), controller.update(config));
  router.post(
    '/:id/logo',
    requirePermission('clients.manage'),
    validate(clientIdSchema),
    logoUploadMiddleware,
    controller.uploadLogo(config),
  );
  router.delete(
    '/:id/logo',
    requirePermission('clients.manage'),
    validate(clientIdSchema),
    controller.removeLogo(config),
  );

  return router;
}
