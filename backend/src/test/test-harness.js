import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDb, disconnectDb } from '../platform/db.js';
import { loadConfig } from '../platform/config.js';
import { createApp } from '../app.js';
import User from '../modules/users/user.model.js';
import RoleMatrix from '../modules/rbac/roleMatrix.model.js';
import { ROLE_IDS } from '@pms/shared';
import { generateAccessToken } from '../modules/auth/token.service.js';
import { testEnv } from './test-env.js';

let memoryServer;

export async function startTestDb() {
  memoryServer = await MongoMemoryServer.create();
  process.env.NODE_ENV = 'test';
  await connectDb(memoryServer.getUri());
}

export async function stopTestDb() {
  await disconnectDb();
  if (memoryServer) await memoryServer.stop();
}

export function getTestConfig() {
  return loadConfig({ ...testEnv, MONGODB_URL: memoryServer?.getUri() ?? testEnv.MONGODB_URL });
}

export function createTestApp() {
  return createApp(getTestConfig());
}

export async function createActiveUser({
  email,
  name = 'Test User',
  roles = [ROLE_IDS.TESTER],
  password = 'password12345',
}) {
  const user = await User.create({
    email,
    name,
    roles,
    status: 'active',
    password,
  });
  return user;
}

export function bearerToken(user, config, opts = {}) {
  return `Bearer ${generateAccessToken(user, config, opts)}`;
}

export async function grantRoleMatrixCustomization(actorId, role, customization) {
  const existing = await RoleMatrix.findOne({ key: 'active' });
  const grants = new Map(existing?.grants ?? []);
  grants.set(role, customization);
  await RoleMatrix.findOneAndUpdate(
    { key: 'active' },
    {
      $set: {
        grants,
        updatedBy: actorId,
      },
      $setOnInsert: { key: 'active' },
    },
    { upsert: true, new: true, runValidators: true },
  );
}
