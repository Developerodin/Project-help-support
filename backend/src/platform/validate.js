import { ApiError } from './errors.js';

const PARTS = ['params', 'query', 'body'];

/**
 * Joi's native error output leaks schema structure and is unstable across
 * versions, so it is MAPPED to a flat { field: message } object rather than
 * passed through. Unknown keys are rejected: silently dropping `role: "admin"`
 * from a body is how a privilege-escalation attempt becomes invisible.
 */
export function validate(schema) {
  return function runValidation(req, _res, next) {
    const fields = {};

    for (const part of PARTS) {
      if (!schema[part]) continue;

      const { value, error } = schema[part].validate(req[part], {
        abortEarly: false,
        convert: true,
        allowUnknown: false,
      });

      if (error) {
        for (const detail of error.details) {
          const key = detail.path.join('.') || part;
          fields[key] = detail.message.replace(/"/g, '');
        }
      } else {
        req[part] = value;
      }
    }

    if (Object.keys(fields).length > 0) {
      return next(new ApiError(400, 'VALIDATION_ERROR', 'Validation failed', fields));
    }
    return next();
  };
}
