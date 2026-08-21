/**
 * Configuration is a pure function of an env object so it is testable without
 * touching process.env. Three tiers:
 *   required   â€” boot fails without them
 *   optional   â€” safe defaults
 *   capability â€” all-or-nothing groups; absent disables the feature, partial is an error
 */

const REQUIRED = ['MONGODB_URL', 'JWT_SECRET', 'FRONTEND_BASE_URL', 'CORS_ORIGINS'];

const CAPABILITY_GROUPS = {
  storage: ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET'],
  email: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'EMAIL_FROM'],
  seed: ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD'],
};

const PLACEHOLDERS = new Set([
  'changeme', 'change-me', 'secret', 'password', 'dev', 'development',
  'test', 'replace-me', 'your-secret-here', 'xxx',
]);

const MIN_SECRET_LENGTH = 32;
const VALID_REFRESH_COOKIE_SAMESITE = new Set(['strict', 'lax', 'none']);

const present = (v) => typeof v === 'string' && v.trim().length > 0;

function readRefreshCookieSameSite(env) {
  const raw = present(env.REFRESH_COOKIE_SAMESITE)
    ? env.REFRESH_COOKIE_SAMESITE.trim().toLowerCase()
    : 'strict';
  if (!VALID_REFRESH_COOKIE_SAMESITE.has(raw)) {
    throw new Error(
      'Config error: REFRESH_COOKIE_SAMESITE must be one of strict, lax, or none.',
    );
  }
  return raw;
}

function readRefreshCookieSecure(env, isProduction) {
  if (!present(env.REFRESH_COOKIE_SECURE)) return isProduction;
  const val = env.REFRESH_COOKIE_SECURE.trim().toLowerCase();
  if (val === 'true' || val === '1') return true;
  if (val === 'false' || val === '0') return false;
  throw new Error('Config error: REFRESH_COOKIE_SECURE must be true or false.');
}

function assertRefreshCookiePolicy(cookie) {
  if (cookie.sameSite === 'none' && !cookie.secure) {
    throw new Error(
      'Config error: REFRESH_COOKIE_SAMESITE=none requires REFRESH_COOKIE_SECURE=true '
      + '(browsers reject SameSite=None cookies without the Secure flag).',
    );
  }
}

/** Mirror Dharwin backend naming so copied .env files enable attachments. */
function normalizeEnv(env) {
  const normalized = { ...env };
  if (!present(normalized.S3_BUCKET) && present(normalized.AWS_S3_BUCKET_NAME)) {
    normalized.S3_BUCKET = normalized.AWS_S3_BUCKET_NAME.trim();
  }
  return normalized;
}

function readGroup(env, name) {
  const keys = CAPABILITY_GROUPS[name];
  const found = keys.filter((k) => present(env[k]));
  if (found.length === 0) return null;
  if (found.length !== keys.length) {
    const missing = keys.filter((k) => !present(env[k]));
    throw new Error(
      `Config error: capability group "${name}" is partially configured. `
      + `Missing: ${missing.join(', ')}. Provide all of [${keys.join(', ')}] or none of them.`,
    );
  }
  return Object.fromEntries(keys.map((k) => [k, env[k].trim()]));
}

function assertProductionSecrets(env, isProduction) {
  if (!isProduction) return;

  const secret = env.JWT_SECRET.trim();
  if (PLACEHOLDERS.has(secret.toLowerCase())) {
    throw new Error('Config error: JWT_SECRET is a known placeholder value in production.');
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `Config error: JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production.`,
    );
  }
  if (present(env.SEED_ADMIN_PASSWORD)
      && PLACEHOLDERS.has(env.SEED_ADMIN_PASSWORD.trim().toLowerCase())) {
    throw new Error('Config error: SEED_ADMIN_PASSWORD is a known placeholder value in production.');
  }
}

export function loadConfig(env = process.env) {
  env = normalizeEnv(env);
  const missing = REQUIRED.filter((k) => !present(env[k]));
  if (missing.length) {
    throw new Error(`Config error: missing required environment variables: ${missing.join(', ')}`);
  }

  const nodeEnv = present(env.NODE_ENV) ? env.NODE_ENV.trim() : 'development';
  const isProduction = nodeEnv === 'production';

  assertProductionSecrets(env, isProduction);

  const storage = readGroup(env, 'storage');
  const email = readGroup(env, 'email');
  const seed = readGroup(env, 'seed');

  const cookie = {
    domain: present(env.COOKIE_DOMAIN) ? env.COOKIE_DOMAIN.trim() : undefined,
    secure: readRefreshCookieSecure(env, isProduction),
    sameSite: readRefreshCookieSameSite(env),
  };
  assertRefreshCookiePolicy(cookie);

  return {
    nodeEnv,
    isProduction,
    port: present(env.PORT) ? Number(env.PORT) : 4000,
    mongoUrl: env.MONGODB_URL.trim(),
    frontendBaseUrl: env.FRONTEND_BASE_URL.trim().replace(/\/$/, ''),
    corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    jwt: {
      secret: env.JWT_SECRET.trim(),
      accessExpirationMinutes: present(env.JWT_ACCESS_EXPIRATION_MINUTES)
        ? Number(env.JWT_ACCESS_EXPIRATION_MINUTES) : 15,
      refreshExpirationDays: present(env.JWT_REFRESH_EXPIRATION_DAYS)
        ? Number(env.JWT_REFRESH_EXPIRATION_DAYS) : 30,
    },
    cookie,
    features: {
      attachments: storage !== null,
      email: email !== null,
      seed: seed !== null,
    },
    storage: storage && {
      region: storage.AWS_REGION,
      accessKeyId: storage.AWS_ACCESS_KEY_ID,
      secretAccessKey: storage.AWS_SECRET_ACCESS_KEY,
      bucket: storage.S3_BUCKET,
    },
    email: email && {
      host: email.SMTP_HOST,
      port: Number(email.SMTP_PORT),
      username: email.SMTP_USERNAME,
      password: email.SMTP_PASSWORD,
      from: email.EMAIL_FROM,
      tlsRejectUnauthorized: !['false', '0'].includes(
        String(env.SMTP_TLS_REJECT_UNAUTHORIZED ?? 'true').trim().toLowerCase(),
      ),
    },
    seed: seed && {
      adminEmail: seed.SEED_ADMIN_EMAIL,
      adminPassword: seed.SEED_ADMIN_PASSWORD,
    },
  };
}

