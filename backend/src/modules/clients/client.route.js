import express from 'express';
import { auth, requireRole } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import { logoUploadMiddleware } from '../../platform/upload.js';
import * as controller from './client.controller.js';
import {
  listClientsSchema, createClientSchema, clientIdSchema, updateClientSchema,
} from './client.validation.js';

export default function clientRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', validate(listClientsSchema), controller.list(config));
  router.post('/', requireRole('admin'), validate(createClientSchema), controller.create(config));
  router.get('/:id', validate(clientIdSchema), controller.get(config));
  router.patch('/:id', requireRole('admin'), validate(updateClientSchema), controller.update(config));
  router.post(
    '/:id/logo',
    requireRole('admin'),
    validate(clientIdSchema),
    logoUploadMiddleware,
    controller.uploadLogo(config),
  );
  router.delete(
    '/:id/logo',
    requireRole('admin'),
    validate(clientIdSchema),
    controller.removeLogo(config),
  );

  return router;
}
