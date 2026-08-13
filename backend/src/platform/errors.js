import logger from './logger.js';

export class ApiError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} code       stable machine-readable code, e.g. 'VALIDATION_ERROR'
   * @param {string} message    human-readable
   * @param {object} [fields]   field-level detail for 400s — mapped, never raw Joi output
   */
  constructor(statusCode, code, message, fields = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.fields = fields;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** Anything that is not an ApiError becomes a non-operational 500. */
export function errorConverter(err, req, res, next) {
  if (err instanceof ApiError) return next(err);
  const converted = new ApiError(500, 'INTERNAL_ERROR', err.message || 'Internal server error');
  converted.isOperational = false;
  converted.stack = err.stack;
  return next(converted);
}

export function errorHandler(config) {
  return function handle(err, req, res, _next) {
    // Log every error, always — including the ones whose message the client never sees.
    logger.error(err.message, {
      requestId: req.id,
      code: err.code,
      statusCode: err.statusCode,
      operational: err.isOperational,
      stack: err.stack,
    });

    const hide = config.isProduction && !err.isOperational;
    const error = {
      code: err.code,
      message: hide ? 'Internal server error' : err.message,
    };
    if (err.fields) error.fields = err.fields;

    return res.status(err.statusCode).json({ error, requestId: req.id });
  };
}
