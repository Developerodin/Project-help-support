import { ApiError } from '../../platform/errors.js';
import { paginate } from '../../platform/paginate.js';
import { safeKey, sniffImageType } from '../../platform/upload.js';
import * as storage from '../../platform/s3.js';
import Project from '../projects/project.model.js';
import Client from './client.model.js';

async function attachLogoUrl(config, clientJson) {
  if (!clientJson?.logoKey || !config?.features?.attachments) {
    return { ...clientJson, logoUrl: null };
  }
  try {
    const logoUrl = await storage.presignGet(config, clientJson.logoKey);
    return { ...clientJson, logoUrl };
  } catch {
    return { ...clientJson, logoUrl: null };
  }
}

async function projectCountsByClient(clientIds) {
  if (!clientIds.length) return new Map();
  const rows = await Project.aggregate([
    { $match: { client: { $in: clientIds }, status: 'active' } },
    { $group: { _id: '$client', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

async function enrichClient(config, clientDoc, projectCount = null) {
  const json = clientDoc.toJSON ? clientDoc.toJSON() : clientDoc;
  const count = projectCount ?? await Project.countDocuments({ client: json.id, status: 'active' });
  return attachLogoUrl(config, { ...json, projectCount: count });
}

export async function createClient(actor, body, config) {
  const name = String(body.name || '').trim();
  if (!name) throw new ApiError(400, 'CLIENT_NAME_REQUIRED', 'Company name is required');

  if (await Client.exists({ name, status: 'active' })) {
    throw new ApiError(409, 'CLIENT_NAME_TAKEN', 'An active company with this name already exists');
  }

  const client = await Client.create({
    name,
    status: body.status || 'active',
    createdBy: actor._id,
  });

  return enrichClient(config, client, 0);
}

export async function listClients(query = {}, config) {
  const filter = {};
  if (query.status) filter.status = query.status;

  const page = await paginate(Client, filter, {
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy || 'name:asc',
  });

  const counts = await projectCountsByClient(page.results.map((c) => c._id));
  const results = await Promise.all(
    page.results.map((c) => enrichClient(config, c, counts.get(String(c._id)) ?? 0)),
  );

  return { ...page, results };
}

export async function getClient(id, config) {
  const client = await Client.findById(id);
  if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Company not found');
  return enrichClient(config, client);
}

export async function updateClient(id, body, config) {
  const client = await Client.findById(id);
  if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Company not found');

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw new ApiError(400, 'CLIENT_NAME_REQUIRED', 'Company name is required');
    if (name !== client.name && await Client.exists({ name, status: 'active' })) {
      throw new ApiError(409, 'CLIENT_NAME_TAKEN', 'An active company with this name already exists');
    }
    client.name = name;
  }

  if (body.status !== undefined) client.status = body.status;

  await client.save();
  return enrichClient(config, client);
}

export async function uploadClientLogo(id, file, actor, config) {
  storage.assertStorageEnabled(config);
  if (!file?.buffer) {
    throw new ApiError(400, 'LOGO_REQUIRED', 'A logo file is required');
  }

  const client = await Client.findById(id);
  if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Company not found');

  const { mime, ext } = sniffImageType(file.buffer, file.originalname);
  const key = safeKey(String(actor._id), ext, { prefix: 'companies' });

  await storage.putObject(config, { key, body: file.buffer, contentType: mime });

  const previousKey = client.logoKey;
  client.logoKey = key;
  await client.save();

  if (previousKey && previousKey !== key) {
    try {
      await storage.deleteObject(config, previousKey);
    } catch {
      // Orphan cleanup is best-effort; the new key is already saved.
    }
  }

  return enrichClient(config, client);
}

export async function removeClientLogo(id, config) {
  storage.assertStorageEnabled(config);

  const client = await Client.findById(id);
  if (!client) throw new ApiError(404, 'CLIENT_NOT_FOUND', 'Company not found');

  const previousKey = client.logoKey;
  client.logoKey = null;
  await client.save();

  if (previousKey) {
    try {
      await storage.deleteObject(config, previousKey);
    } catch {
      // Best-effort cleanup.
    }
  }

  return enrichClient(config, client);
}
