import mongoose from 'mongoose';
import logger from '../../platform/logger.js';
import User from '../users/user.model.js';
import Team from '../teams/team.model.js';
import { recordRbacAudit } from '../rbac/rbac-audit.js';

const TEXT_LIMIT = 200;
const DATE_FIELDS = new Set(['estimatedResolutionAt', 'expectedReleaseDate']);
const USER_FIELDS = new Set(['assignedTo', 'testedBy']);
const TEAM_FIELDS = new Set(['team']);
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const idOf = (value) => value?._id ?? value;

/** JSON-safe, comparable form of a ticket field value; empty values all read as null. */
function comparable(field, value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => comparable(field, item)) : null;
  }
  if (DATE_FIELDS.has(field) || value instanceof Date) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
  if (value instanceof mongoose.Types.ObjectId) return String(value);
  if (typeof value === 'object' && value._id) return String(value._id);
  return value;
}

function clip(value) {
  if (typeof value === 'string' && value.length > TEXT_LIMIT) return `${value.slice(0, TEXT_LIMIT)}…`;
  if (Array.isArray(value)) return value.map(clip);
  return value;
}

/** Only the fields whose value actually moved, with from/to in storable form. */
export function diffTicketChanges(changes = []) {
  return changes
    .map(({ field, from, to }) => ({ field, from: comparable(field, from), to: comparable(field, to) }))
    .filter((change) => JSON.stringify(change.from) !== JSON.stringify(change.to));
}

/** Names are snapshotted at write time so the row still reads after a user or team is renamed or removed. */
async function withRefLabels(changes) {
  const idsFor = (fields) => [...new Set(changes
    .filter((c) => fields.has(c.field))
    .flatMap((c) => [c.from, c.to])
    .filter((id) => OBJECT_ID_PATTERN.test(String(id ?? ''))))];
  const userIds = idsFor(USER_FIELDS);
  const teamIds = idsFor(TEAM_FIELDS);
  if (!userIds.length && !teamIds.length) return changes;

  const [users, teams] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds } }, 'name email').lean() : [],
    teamIds.length ? Team.find({ _id: { $in: teamIds } }, 'name').lean() : [],
  ]);
  const userNames = new Map(users.map((u) => [String(u._id), u.name || u.email]));
  const teamNames = new Map(teams.map((t) => [String(t._id), t.name]));

  return changes.map((change) => {
    let names = null;
    if (USER_FIELDS.has(change.field)) names = userNames;
    else if (TEAM_FIELDS.has(change.field)) names = teamNames;
    if (!names) return change;
    return {
      ...change,
      fromLabel: names.get(String(change.from)) ?? null,
      toLabel: names.get(String(change.to)) ?? null,
    };
  });
}

function projectKeyOf(ticketId) {
  const key = String(ticketId || '');
  const dash = key.lastIndexOf('-');
  return dash > 0 ? key.slice(0, dash) : null;
}

/**
 * Cross-project, permanent record of a ticket mutation (audit category `ticket`).
 * Each row carries its own ticket and project snapshot so it outlives the ticket.
 * Never throws: a lost audit row must not fail the mutation it describes.
 */
export async function recordTicketAudit(actor, action, ticket, details = {}, { via } = {}) {
  try {
    const projectId = idOf(ticket.project);
    const payload = {
      ticketId: ticket.ticketId,
      ticket: String(ticket._id),
      projectId: projectId ? String(projectId) : null,
      projectKey: projectKeyOf(ticket.ticketId),
      title: clip(ticket.title),
      via: via || 'app',
      ...Object.fromEntries(Object.entries(details).map(([key, value]) => [key, key === 'changes' ? value : clip(value)])),
    };
    if (Array.isArray(payload.changes)) {
      payload.changes = (await withRefLabels(payload.changes))
        .map((change) => ({ ...change, from: clip(change.from), to: clip(change.to) }));
    }
    await recordRbacAudit(actor, action, payload);
  } catch (err) {
    logger.error('ticket.audit_failed', {
      action,
      ticketId: ticket?.ticketId ?? null,
      error: err.message,
    });
  }
}
