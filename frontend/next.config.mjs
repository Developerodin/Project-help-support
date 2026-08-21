import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Env comes from frontend/.env, which Next loads on its own before this file is
 * read — no @next/env, no forceReload, no cross-reading the backend's file.
 *
 * NO rewrite of /api/v1. The API base is always an explicit absolute URL.
 * A rewrite here is what makes a missing NEXT_PUBLIC_API_URL look like it works
 * in development and 404 silently everywhere else.
 */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pms/shared'],
  // Monorepo root — avoids Next picking C:\Users\INTEL\package-lock.json.
  outputFileTracingRoot: path.join(__dirname, '..'),
};

// `next dev` keeps .next; `next build`/`next start` use .next-prod. Sharing one
// dist dir lets a build overwrite the webpack runtime a running dev server owns,
// leaving chunks from two compilations side by side -> "Cannot find module './157.js'".
export default (phase) => ({
  ...nextConfig,
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next' : '.next-prod',
});
