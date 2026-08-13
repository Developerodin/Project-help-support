import mongoose from 'mongoose';
import logger from './logger.js';

export async function connectDb(url) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(url);
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
