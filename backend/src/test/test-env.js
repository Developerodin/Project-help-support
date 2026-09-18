export const testEnv = {
  NODE_ENV: 'test',
  MONGODB_URL: 'mongodb://127.0.0.1:27017/pms-test-placeholder',
  JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
  FRONTEND_BASE_URL: 'http://localhost:3002',
  CORS_ORIGINS: 'http://localhost:3002',
  JWT_ACCESS_EXPIRATION_MINUTES: '15',
  JWT_REFRESH_EXPIRATION_DAYS: '7',
};
