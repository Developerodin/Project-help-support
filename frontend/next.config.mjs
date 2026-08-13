/**
 * NO rewrite of /api/v1. The API base is always an explicit absolute URL.
 * A rewrite here is what makes a missing NEXT_PUBLIC_API_URL look like it works
 * in development and 404 silently everywhere else.
 */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pms/shared'],
};

export default nextConfig;
