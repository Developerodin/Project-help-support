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

/**
 * Known library errors that are the client's doing (or a lost race) map to a
 * 4xx. Matched by name/code rather than instanceof so this module needs neither
 * mongoose nor multer. Messages are fixed: raw ones can name collections/paths.
 */
function convertKnown(err) {
  if (err.code === 11000 || err.code === 11001) {
    return new ApiError(409, 'CONFLICT', 'That record already exists');
  }
  if (err.name === 'VersionError') {
    return new ApiError(409, 'CONFLICT', 'This record was changed by someone else. Reload and try again');
  }
  if (err.name === 'ValidationError' && err.errors && typeof err.errors === 'object') {
    const fields = Object.fromEntries(
      Object.entries(err.errors).map(([path, e]) => [path, e?.kind === 'required' ? `${path} is required` : 'Invalid value']),
    );
    return new ApiError(400, 'VALIDATION_ERROR', 'Validation failed', fields);
  }
  if (err.name === 'CastError') {
    return new ApiError(400, 'VALIDATION_ERROR', err.path ? `Invalid ${err.path}` : 'Invalid value');
  }
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') return new ApiError(413, 'FILE_TOO_LARGE', 'File is too large');
    return new ApiError(400, 'UPLOAD_ERROR', err.message || 'Upload rejected');
  }
  return null;
}

/** Anything that is not an ApiError or a known client error becomes a non-operational 500. */
export function errorConverter(err, req, res, next) {
  if (err instanceof ApiError) return next(err);
  const known = convertKnown(err);
  if (known) {
    known.stack = err.stack;
    return next(known);
  }
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
