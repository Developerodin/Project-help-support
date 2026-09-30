import { after, before, beforeEach } from 'node:test';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongo;

export function getMemoryUri() {
  if (!mongo) throw new Error('Memory DB not started');
  return mongo.getUri();
}

export function withMemoryDb() {
  before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  beforeEach(async () => {
    const collections = mongoose.connection.collections;
    await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
  });

  after(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });
}
