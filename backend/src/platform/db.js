import mongoose from 'mongoose';
import logger from './logger.js';

// autoIndex stays on (the default) in every environment: nothing else builds
// indexes (no syncIndexes step or migration), so turning it off in production
// would silently drop new ones such as the audit log outboxId unique index.
// ponytail: move index builds to a deploy step before turning autoIndex off.
const CONNECT_OPTIONS = {
  // Fail boot (and each query) after 10s without a reachable primary, not 30s.
  serverSelectionTimeoutMS: 10_000,
  maxPoolSize: 20,
};

let listenersAttached = false;

function attachConnectionLogging() {
  if (listenersAttached) return;
  listenersAttached = true;
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB connection error', { error: err.message }));
}

export async function connectDb(url) {
  mongoose.set('strictQuery', true);
  attachConnectionLogging();
  await mongoose.connect(url, CONNECT_OPTIONS);
  logger.info('MongoDB connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}

/** 1 === connected. Used by GET /ready, which is why it reads live state. */
export function isDbReady() {
  return mongoose.connection.readyState === 1;
}
