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
const DEFAULT_EMAIL_RETRY_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_EMAIL_RETRY_GRACE_MS = 5 * 60 * 1000;
const DEFAULT_EMAIL_RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_EMAIL_RETRY_BATCH_LIMIT = 100;

const present = (v) => typeof v === 'string' && v.trim().length > 0;

function readBoolean(env, key, defaultValue = false) {
  if (!present(env[key])) return defaultValue;
  const raw = env[key].trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new Error(`Config error: ${key} must be true or false.`);
}

function readPositiveInt(env, key, defaultValue) {
  if (!present(env[key])) return defaultValue;
  const value = Number(env[key]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Config error: ${key} must be a positive integer.`);
  }
  return value;
}

function readCsvSet(env, key) {
  if (!present(env[key])) return new Set();
  return new Set(
    env[key]
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function readRefreshCookieSameSite(env) {
  const raw = present(env.REFRESH_COOKIE_SAMESITE)
    ? env.REFRESH_COOKIE_SAMESITE.trim().toLowerCase()
    : 'none';
  if (!VALID_REFRESH_COOKIE_SAMESITE.has(raw)) {
    throw new Error(
      'Config error: REFRESH_COOKIE_SAMESITE must be one of strict, lax, or none.',
    );
  }
  return raw;
}

function readRefreshCookieSecure(env, isProduction, sameSite) {
  if (!present(env.REFRESH_COOKIE_SECURE)) {
    if (sameSite === 'none' || isProduction) return true;
    return false;
  }
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

function readTicketNotificationSink(env, isProduction) {
  const enabled = readBoolean(env, 'TICKET_NOTIFICATION_TEST_EMAIL_ENABLED', false);
  if (!enabled) {
    return { enabled: false, to: '' };
  }

  const to = present(env.TICKET_NOTIFICATION_TEST_EMAIL)
    ? env.TICKET_NOTIFICATION_TEST_EMAIL.trim().toLowerCase()
    : '';
  if (!to) {
    throw new Error(
      'Config error: TICKET_NOTIFICATION_TEST_EMAIL must be set when '
      + 'TICKET_NOTIFICATION_TEST_EMAIL_ENABLED=true.',
    );
  }

  if (!isProduction) return { enabled: true, to };

  const allowInProd = readBoolean(env, 'TICKET_NOTIFICATION_TEST_EMAIL_ALLOW_PRODUCTION', false);
  if (!allowInProd) {
    throw new Error(
      'Config error: ticket notification test sink is disabled in production unless '
      + 'TICKET_NOTIFICATION_TEST_EMAIL_ALLOW_PRODUCTION=true.',
    );
  }

  const allowlist = readCsvSet(env, 'TICKET_NOTIFICATION_TEST_EMAIL_PRODUCTION_ALLOWLIST');
  if (allowlist.size === 0 || !allowlist.has(to)) {
    throw new Error(
      'Config error: production test sink requires TICKET_NOTIFICATION_TEST_EMAIL '
      + 'to be present in TICKET_NOTIFICATION_TEST_EMAIL_PRODUCTION_ALLOWLIST.',
    );
  }

  return { enabled: true, to };
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
  const ticketNotificationSink = readTicketNotificationSink(env, isProduction);

  const sameSite = readRefreshCookieSameSite(env);
  const cookie = {
    domain: present(env.COOKIE_DOMAIN) ? env.COOKIE_DOMAIN.trim() : undefined,
    sameSite,
    secure: readRefreshCookieSecure(env, isProduction, sameSite),
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
      testSinkEnabled: ticketNotificationSink.enabled,
      testSinkTo: ticketNotificationSink.to,
      retryIntervalMs: readPositiveInt(
        env,
        'EMAIL_RETRY_INTERVAL_MS',
        DEFAULT_EMAIL_RETRY_INTERVAL_MS,
      ),
      retryGraceMs: readPositiveInt(
        env,
        'EMAIL_RETRY_GRACE_MS',
        DEFAULT_EMAIL_RETRY_GRACE_MS,
      ),
      retryMaxAttempts: readPositiveInt(
        env,
        'EMAIL_RETRY_MAX_ATTEMPTS',
        DEFAULT_EMAIL_RETRY_MAX_ATTEMPTS,
      ),
      retryBatchLimit: readPositiveInt(
        env,
        'EMAIL_RETRY_BATCH_LIMIT',
        DEFAULT_EMAIL_RETRY_BATCH_LIMIT,
      ),
      tlsRejectUnauthorized: !['false', '0'].includes(
        String(env.SMTP_TLS_REJECT_UNAUTHORIZED ?? 'true').trim().toLowerCase(),
      ),
    },
    seed: seed && {
      adminEmail: seed.SEED_ADMIN_EMAIL,
      adminPassword: seed.SEED_ADMIN_PASSWORD,
    },
    branding: {
      neutralName: 'ProwPlus',
      neutralLogoUrl: present(env.NEUTRAL_BRAND_LOGO_URL)
        ? env.NEUTRAL_BRAND_LOGO_URL.trim()
        : null,
      neutralFaviconUrl: present(env.NEUTRAL_BRAND_FAVICON_URL)
        ? env.NEUTRAL_BRAND_FAVICON_URL.trim()
        : null,
      emailLogoPath: present(env.EMAIL_BRAND_MARK_PATH)
        ? env.EMAIL_BRAND_MARK_PATH.trim()
        : null,
    },
  };
}

