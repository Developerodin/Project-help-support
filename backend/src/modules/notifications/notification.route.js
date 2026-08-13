import express from 'express';
import Joi from 'joi';
import { auth } from '../../platform/auth.js';
import { validate } from '../../platform/validate.js';
import * as controller from './notification.controller.js';

const listSchema = {
  query: Joi.object({
    unread: Joi.boolean(),
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
  }),
};

const idSchema = { params: Joi.object({ id: Joi.string().hex().length(24).required() }) };

export default function notificationRoutes(config) {
  const router = express.Router();
  router.use(auth(config));

  router.get('/', validate(listSchema), controller.list);
  router.post('/read-all', controller.readAll);
  router.patch('/:id/read', validate(idSchema), controller.read);

  return router;
}
