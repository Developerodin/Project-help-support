import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Monorepo root — single .env for backend + frontend. Next already ran its own
// loadEnvConfig against frontend/ (no .env there) before reading this file, and
// @next/env caches that result at module scope — forceReload=true is what makes
// the second load actually read Project Management/.env instead of the cache.
const { combinedEnv } = loadEnvConfig(
  rootDir,
  process.env.NODE_ENV !== 'production',
  console,
  true, // forceReload — see above
);
const apiUrl = combinedEnv.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_URL;

if (apiUrl) {
  process.env.NEXT_PUBLIC_API_URL = apiUrl;
}

/**
 * NO rewrite of /api/v1. The API base is always an explicit absolute URL.
 * A rewrite here is what makes a missing NEXT_PUBLIC_API_URL look like it works
 * in development and 404 silently everywhere else.
 */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pms/shared'],
  // Monorepo root — avoids Next picking C:\Users\INTEL\package-lock.json.
  outputFileTracingRoot: rootDir,
  // loadEnvConfig above reads Project Management/.env, but Next still collects
  // NEXT_PUBLIC_* from frontend/ for SSR/client inlining — passthrough bridges both.
  env: {
    NEXT_PUBLIC_API_URL: apiUrl,
  },
};

export default nextConfig;
