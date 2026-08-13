import { randomUUID } from 'node:crypto';

const MAX_INBOUND_LENGTH = 200;

/**
 * FIRST middleware in the stack. Every response — 401, 400, 404, 500 — must
 * carry an id, which is only true if this runs before auth, validation and routing.
 */
export function requestId(req, res, next) {
  const inbound = req.headers['x-request-id'];
  req.id = typeof inbound === 'string'
    && inbound.length > 0
    && inbound.length <= MAX_INBOUND_LENGTH
    ? inbound
    : randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}
