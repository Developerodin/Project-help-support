/**
 * In-process SSE fan-out. One Node process = one hub; multi-instance deploys would
 * need a shared bus (Redis, etc.) — out of scope for this slice.
 */

/** @typedef {{ res: import('express').Response, userId: string, projectId: string | null }} SseClient */

const clients = new Set();

export function subscribe(client) {
  clients.add(client);
}

export function unsubscribe(client) {
  clients.delete(client);
}

export function clientCount() {
  return clients.size;
}

export function userClientCount(userId) {
  const key = String(userId);
  let count = 0;
  for (const client of clients) {
    if (client.userId === key) count += 1;
  }
  return count;
}

/** Shutdown: end every open stream so server.close() is not held open by them. */
export function closeAll() {
  for (const client of clients) {
    try {
      client.res.end();
    } catch {
      // Already torn down; nothing to end.
    }
  }
  clients.clear();
}

/** Test-only: drop all subscribers between cases. */
export function resetForTests() {
  clients.clear();
}

function writeEvent(client, payload) {
  if (client.res.writableEnded || client.res.destroyed) {
    unsubscribe(client);
    return;
  }
  client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function publishToUsers(userIds, payload) {
  const targets = new Set((userIds || []).map((id) => String(id)).filter(Boolean));
  if (targets.size === 0) return;
  for (const client of clients) {
    if (targets.has(client.userId)) writeEvent(client, payload);
  }
}

export function publishToProject(projectId, payload, { excludeUserId = null } = {}) {
  if (!projectId) return;
  const projectKey = String(projectId);
  const exclude = excludeUserId ? String(excludeUserId) : null;
  for (const client of clients) {
    if (exclude && client.userId === exclude) continue;
    if (client.projectId && client.projectId === projectKey) writeEvent(client, payload);
  }
}
