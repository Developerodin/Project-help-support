import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  silent: process.env.NODE_ENV === 'test',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
});

/**
 * EventSource cannot send an Authorization header, so /v1/realtime/stream takes
 * its access token in the query string. Nothing may write that URL verbatim —
 * an access token is a bearer credential and a log line is a copy of it.
 *
 * ponytail: our own access log only. Any reverse proxy in front of this still
 * logs the raw request line, so REALTIME_SSE notes in .env.example tell the
 * operator to redact it there too. Upgrade path: mint a short-lived SSE ticket
 * from an authenticated POST and keep the access token out of URLs entirely.
 */
export function redactSensitiveQuery(url) {
  if (!url || !url.includes('token=')) return url;
  // `token` is the email unsubscribe link's.
  return url.replace(/([?&](?:access_)?token=)[^&]*/g, '$1REDACTED');
}

export default logger;
