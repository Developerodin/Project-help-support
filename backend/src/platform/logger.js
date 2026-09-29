import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  silent: process.env.NODE_ENV === 'test',
  // JSON in production for log tooling; `info: message key=value` locally, like Dharwin.
  format: process.env.NODE_ENV === 'production'
    ? winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json(),
    )
    : winston.format.combine(
      winston.format.errors({ stack: true }),
      winston.format.colorize(),
      winston.format.printf(({ level, message, stack, ...meta }) => {
        const extra = Object.entries(meta).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`);
        // Expected 4xx (operational) errors skip the stack; crashes keep it.
        const trace = stack && meta.operational !== true ? `\n${stack}` : '';
        return [`${level}: ${message}`, ...extra].join(' ') + trace;
      }),
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
  // `token` is the email unsubscribe link's; `hub.verify_token` is Meta's WhatsApp handshake.
  return url.replace(/([?&](?:access_|hub\.verify_)?token=)[^&]*/g, '$1REDACTED');
}

export default logger;
