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
  whatsapp: ['WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'],
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
const DEFAULT_EMAIL_BATCH_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_EMAIL_BATCH_MAX_MS = 15 * 60 * 1000;

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

// Checked at boot so a typo fails loudly instead of every slot silently
// falling back. Same Intl probe the prefs validation uses.
function readTimeZone(env, key, defaultValue) {
  if (!present(env[key])) return defaultValue;
  const tz = env[key].trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new Error(`Config error: ${key} must be an IANA time zone, e.g. Asia/Kolkata.`);
  }
  return tz;
}

function readPositiveNumber(env, key, defaultValue) {
  if (!present(env[key])) return defaultValue;
  const value = Number(env[key]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Config error: ${key} must be a positive number.`);
  }
  return value;
}

/**
 * OpenAI's short-context list prices (USD per 1M tokens), checked 2026-09-24
 * against developers.openai.com/api/docs/pricing. A model not listed here is
 * costed at the priciest one, so the spend cap errs on the safe side.
 * ponytail: input is all charged at the full rate, though cached input is 90%
 * cheaper; subtract input_tokens_details.cached_tokens if the meter reads high.
 */
const CHAT_PRICES = {
  'gpt-6-luna': { inputPerM: 0.1, outputPerM: 0.5 },
  'gpt-6-sol': { inputPerM: 2, outputPerM: 10 },
  'gpt-5.6-terra': { inputPerM: 2, outputPerM: 12 },
  'gpt-5.6-sol': { inputPerM: 4, outputPerM: 20 },
};
const chatPricesFor = (model) => CHAT_PRICES[model] ?? CHAT_PRICES['gpt-5.6-sol'];

function readHttps(env) {
  if (!present(env.HTTPS_KEY_FILE) && !present(env.HTTPS_CERT_FILE)) return null;
  if (!present(env.HTTPS_KEY_FILE) || !present(env.HTTPS_CERT_FILE)) {
    throw new Error('Config error: set both HTTPS_KEY_FILE and HTTPS_CERT_FILE, or neither.');
  }
  return { keyFile: env.HTTPS_KEY_FILE.trim(), certFile: env.HTTPS_CERT_FILE.trim() };
}

const PUSH_KEYS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];

// Web push. All three or none; generate the key pair with `npx web-push generate-vapid-keys`.
function readPush(env) {
  const set = PUSH_KEYS.filter((k) => present(env[k]));
  if (set.length === 0) return null;
  if (set.length < PUSH_KEYS.length) {
    throw new Error(`Config error: set all of ${PUSH_KEYS.join(', ')}, or none.`);
  }
  const subject = env.VAPID_SUBJECT.trim();
  // Apple's push service rejects any other subject form.
  if (!/^(mailto:|https:\/\/)/.test(subject)) {
    throw new Error('Config error: VAPID_SUBJECT must be a mailto: address or an https:// URL.');
  }
  return {
    publicKey: env.VAPID_PUBLIC_KEY.trim(),
    privateKey: env.VAPID_PRIVATE_KEY.trim(),
    subject,
  };
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

/**
 * Real boot only (index.js). loadConfig itself still defaults to development so
 * tests can build a config without it; a server must say which mode it is in,
 * since production turns on secret checks, secure cookies and background jobs.
 */
export function assertNodeEnvSet(env = process.env) {
  if (!present(env.NODE_ENV)) {
    throw new Error(
      'Config error: NODE_ENV is not set. Use NODE_ENV=production on servers, development locally.',
    );
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
  const whatsapp = readGroup(env, 'whatsapp');
  const ticketNotificationSink = readTicketNotificationSink(env, isProduction);
  const push = readPush(env);

  const chatModel = present(env.OPENAI_CHAT_MODEL) ? env.OPENAI_CHAT_MODEL.trim() : 'gpt-5.6-terra';
  const chatPrices = chatPricesFor(chatModel);

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
    // Seeds, legacy migrations, backfills, outbox replays and the retry/flush
    // sweeps. On by default only in production so a dev box pointed at a shared
    // database does not run them on every restart.
    runBackgroundJobs: readBoolean(env, 'RUN_BACKGROUND_JOBS', isProduction),
    port: present(env.PORT) ? Number(env.PORT) : 4000,
    // Local https (scripts/dev-https-certs.sh), so LAN devices get the mic. Both paths or neither.
    // ponytail: production terminates TLS at nginx and leaves these unset.
    https: readHttps(env),
    mongoUrl: env.MONGODB_URL.trim(),
    frontendBaseUrl: env.FRONTEND_BASE_URL.trim().replace(/\/$/, ''),
    // Where mail providers reach this API (the one-click List-Unsubscribe
    // POST). Unset: ticket mail carries no List-Unsubscribe header, only the
    // footer links, which go through the frontend.
    apiPublicUrl: present(env.API_PUBLIC_URL) ? env.API_PUBLIC_URL.trim().replace(/\/$/, '') : null,
    // Hourly/daily slots and quiet hours for anyone without a zone of their own.
    defaultTimeZone: readTimeZone(env, 'DEFAULT_TIME_ZONE', 'Asia/Kolkata'),
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
      assistant: present(env.OPENAI_API_KEY),
      push: push !== null,
    },
    push,
    // Chatbot. Off unless OPENAI_API_KEY is set; the model names are overridable
    // so a model swap is an env change, not a deploy.
    assistant: present(env.OPENAI_API_KEY) ? {
      apiKey: env.OPENAI_API_KEY.trim(),
      chatModel,
      transcribeModel: present(env.OPENAI_TRANSCRIBE_MODEL)
        // The full model: far better than mini at Hindi-English switching mid-sentence.
        ? env.OPENAI_TRANSCRIBE_MODEL.trim() : 'gpt-4o-transcribe',
      speechModel: present(env.OPENAI_TTS_MODEL) ? env.OPENAI_TTS_MODEL.trim() : 'gpt-4o-mini-tts',
      // One voice per language, each with its own accent (see openai.client.js).
      speechVoice: present(env.OPENAI_TTS_VOICE) ? env.OPENAI_TTS_VOICE.trim() : 'marin',
      speechVoiceHindi: present(env.OPENAI_TTS_VOICE_HI) ? env.OPENAI_TTS_VOICE_HI.trim() : 'coral',
      // Spend caps. Each user may spend this much per day across chat and voice,
      // costed from the prices below; the day follows budgetTimeZone.
      userDailyBudgetInr: readPositiveNumber(env, 'ASSISTANT_USER_DAILY_BUDGET_INR', 100),
      usdToInr: readPositiveNumber(env, 'ASSISTANT_USD_TO_INR', 88),
      budgetTimeZone: present(env.ASSISTANT_BUDGET_TIMEZONE) ? env.ASSISTANT_BUDGET_TIMEZONE.trim() : 'Asia/Kolkata',
      monthlyTokenBudget: readPositiveInt(env, 'ASSISTANT_MONTHLY_TOKEN_BUDGET', 10_000_000),
      // USD list prices. Defaults are OpenAI's published prices for the default
      // models; update them when models or prices change.
      prices: {
        chatInputPerM: readPositiveNumber(env, 'ASSISTANT_PRICE_CHAT_INPUT_PER_M', chatPrices.inputPerM),
        chatOutputPerM: readPositiveNumber(env, 'ASSISTANT_PRICE_CHAT_OUTPUT_PER_M', chatPrices.outputPerM),
        transcribePerMin: readPositiveNumber(env, 'ASSISTANT_PRICE_TRANSCRIBE_PER_MIN', 0.006),
        speechPerMin: readPositiveNumber(env, 'ASSISTANT_PRICE_SPEECH_PER_MIN', 0.015),
      },
    } : null,
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
      // Routine ticket mail waits this long for more updates on the same
      // ticket (each one restarts the wait), but never past the max.
      batchWindowMs: readPositiveInt(env, 'EMAIL_BATCH_WINDOW_MS', DEFAULT_EMAIL_BATCH_WINDOW_MS),
      batchMaxMs: readPositiveInt(env, 'EMAIL_BATCH_MAX_MS', DEFAULT_EMAIL_BATCH_MAX_MS),
      tlsRejectUnauthorized: !['false', '0'].includes(
        String(env.SMTP_TLS_REJECT_UNAUTHORIZED ?? 'true').trim().toLowerCase(),
      ),
    },
    seed: seed && {
      adminEmail: seed.SEED_ADMIN_EMAIL,
      adminPassword: seed.SEED_ADMIN_PASSWORD,
    },
    // Meta webhook at /v1/whatsapp/webhook, answered by the assistant. Absent: off.
    whatsapp: whatsapp && {
      verifyToken: whatsapp.WHATSAPP_VERIFY_TOKEN,
      appSecret: whatsapp.WHATSAPP_APP_SECRET,
      token: whatsapp.WHATSAPP_TOKEN,
      phoneNumberId: whatsapp.WHATSAPP_PHONE_NUMBER_ID,
    },
    realtime: {
      enabled: readBoolean(env, 'REALTIME_SSE_ENABLED', true),
      sseHeartbeatMs: readPositiveInt(env, 'REALTIME_SSE_HEARTBEAT_MS', 25_000),
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

