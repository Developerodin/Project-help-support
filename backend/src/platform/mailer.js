import nodemailer from 'nodemailer';
import logger from './logger.js';

let transport = null;

/**
 * ONE application-level transport, created at boot and reused for the lifetime
 * of the process.
 *
 * The pool queues internally, so a fan-out needs no hand-built queue. The
 * failure mode behind O365's `432 4.3.2 Concurrent connections limit exceeded`
 * is creating a transport per send or per request — not awaiting many sends
 * against one pool.
 */
export function getTransport(config) {
  if (!config.features.email) return null;

  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.port === 465,
      auth: { user: config.email.username, pass: config.email.password },
      pool: true,
      maxConnections: 2,
      maxMessages: 100,
    });
    logger.info('SMTP transport created (pooled, maxConnections=2)');
  }

  return transport;
}

/** Recreation under controlled conditions — an unhealthy pool, or a test. */
export function resetTransport() {
  transport?.close?.();
  transport = null;
}
