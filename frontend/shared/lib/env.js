/**
 * No default. No `/api/v1` fallback. No rewrite.
 *
 * Next evaluates this module during the build, so an unset variable fails the
 * BUILD rather than producing an app that 404s every request at runtime with
 * nothing in the logs to explain it.
 */
export function requireEnv(name, value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `${name} is not set. The API base URL must be explicit — there is no fallback.`,
    );
  }
  return value.trim().replace(/\/$/, '');
}

export const API_URL = requireEnv('NEXT_PUBLIC_API_URL', process.env.NEXT_PUBLIC_API_URL);
