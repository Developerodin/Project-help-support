import { before, after, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let currentUri = null;

/** The URI of the running in-memory server, for tests that reconnect deliberately. */
export function getMemoryUri() {
  return currentUri;
}

/**
 * Call at the top of a test file that needs a real MongoDB.
 * Standalone, not a replica set — the codebase uses no transactions by design.
 */
export function withMemoryDb() {
  let server;

  before(async () => {
    server = await MongoMemoryServer.create();
    currentUri = server.getUri();
    await mongoose.connect(currentUri);
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState !== 1) await mongoose.connect(currentUri);
    const { collections } = mongoose.connection;
    await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  });

  after(async () => {
    await mongoose.disconnect();
    await server.stop();
    currentUri = null;
  });
}
