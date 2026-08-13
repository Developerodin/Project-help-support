import { LANES, laneOf, STAGE_KEYS, stageIndex } from '@pms/shared';
import Ticket from './ticket.model.js';
import { buildTicketFilter } from './ticket.service.js';

/**
 * Computed in the service over lean() documents, not in an aggregation
 * pipeline. Time-in-stage means walking consecutive stageHistory pairs, which
 * in MongoDB requires $map over array indices with $arrayElemAt — correct but
 * effectively unreadable, and unreviewable when it is wrong.
 *
 * CEILING: when a single project passes roughly ten thousand tickets, move
 * time-in-stage to an aggregation or a nightly rollup.
 *
 * Every analysis projects ONLY the fields it needs. Never whole documents.
 */

const emptyLanes = () => Object.fromEntries(LANES.map((lane) => [lane.key, 0]));
const emptyStages = () => Object.fromEntries(STAGE_KEYS.map((key) => [key, 0]));

export async function overview(actor, query = {}) {
  const filter = buildTicketFilter(actor, query);

  const tickets = await Ticket.find(filter).select('status severity labels').lean();

  const lanes = emptyLanes();
  const byStage = emptyStages();
  let blockerCritical = 0;

  for (const ticket of tickets) {
    byStage[ticket.status] += 1;
    lanes[laneOf(ticket.status)] += 1;

    // Deliberately overlapping: a critical ticket is also counted in its lane.
    // It is reported BESIDE the tiles, never as one of them, so the lane tiles
    // keep summing to the total.
    if (ticket.severity === 'Critical' || ticket.severity === 'Blocker') {
      blockerCritical += 1;
    }
  }

  return { total: tickets.length, lanes, byStage, blockerCritical };
}

const HOUR_MS = 3600000;

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * NEAREST-RANK percentile: the value at the ceil(p x n)-th position.
 * Several defensible p90 definitions exist and they disagree on small samples;
 * naming the one in use is what keeps the number reproducible.
 */
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

/**
 * A stage's duration is the gap between entering it and entering the NEXT one.
 *
 * The final entry is the stage the ticket is in right now — an open interval.
 * It is EXCLUDED rather than measured to `now`, because mixing completed and
 * in-flight durations into one median makes the number mean nothing.
 *
 * Skipped stages produce no entry and therefore no duration, which is exactly
 * what forward-skip analytics should report.
 */
export function stageDurations(stageHistory) {
  const durations = [];

  for (let i = 0; i < stageHistory.length - 1; i += 1) {
    const entered = new Date(stageHistory[i].at).getTime();
    const left = new Date(stageHistory[i + 1].at).getTime();
    durations.push({ stage: stageHistory[i].to, ms: left - entered });
  }

  return durations;
}

export async function timeInStage(actor, query = {}) {
  const filter = buildTicketFilter(actor, query);

  const tickets = await Ticket.find(filter).select('stageHistory').lean();

  const samples = Object.fromEntries(STAGE_KEYS.map((key) => [key, []]));

  for (const ticket of tickets) {
    for (const duration of stageDurations(ticket.stageHistory || [])) {
      samples[duration.stage]?.push(duration.ms);
    }
  }

  const byStage = {};
  let bottleneck = null;
  let worstMedian = -1;

  for (const key of STAGE_KEYS) {
    const values = samples[key];
    const medianMs = median(values);
    const p90Ms = percentile(values, 0.9);

    byStage[key] = {
      count: values.length,
      medianHours: medianMs === null ? null : Number((medianMs / HOUR_MS).toFixed(2)),
      p90Hours: p90Ms === null ? null : Number((p90Ms / HOUR_MS).toFixed(2)),
    };

    if (medianMs !== null && medianMs > worstMedian) {
      worstMedian = medianMs;
      bottleneck = key;
    }
  }

  return { byStage, bottleneck };
}

const DAY_MS = 86400000;
const QA_ENTRY_INDEX = stageIndex('ready_qa');

const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

/**
 * actualResolutionAt = the stageHistory entry whose `to` is 'live'
 * variance           = actualResolutionAt − estimatedResolutionAt
 *   < 0 early ·  = 0 on time ·  > 0 late
 *
 * Compared by CALENDAR DAY: an estimate is a date, and a ticket that shipped at
 * 17:30 on the estimated day is on time, not eight hours late.
 *
 * A ticket that never reached `live`, or was never estimated, is NOT MEASURABLE
 * and is excluded — counting it as on time would flatter every report.
 */
export async function estimateAccuracy(actor, query = {}) {
  const filter = buildTicketFilter(actor, query);

  const tickets = await Ticket.find(filter)
    .select('estimatedResolutionAt stageHistory')
    .lean();

  let early = 0;
  let onTime = 0;
  let late = 0;

  for (const ticket of tickets) {
    if (!ticket.estimatedResolutionAt) continue;

    const wentLive = (ticket.stageHistory || []).find((entry) => entry.to === 'live');
    if (!wentLive) continue;

    const actual = dayKey(wentLive.at);
    const estimated = dayKey(ticket.estimatedResolutionAt);

    if (actual < estimated) early += 1;
    else if (actual === estimated) onTime += 1;
    else late += 1;
  }

  return {
    measured: early + onTime + late,
    early,
    onTime,
    late,
    // Reported as a distribution across three buckets, never as one number.
    buckets: { early, onTime, late },
  };
}

/**
 * Reopens whose ORIGIN stage was ready_qa or later, over tickets that reached
 * QA at all. Distinct from raw reopenCount — and the more useful of the two,
 * because it measures work QA sent back rather than churn in general.
 */
export async function reopenAfterQa(actor, query = {}) {
  const filter = buildTicketFilter(actor, query);

  const tickets = await Ticket.find(filter).select('stageHistory').lean();

  let reachedQa = 0;
  let reopenedAfterQa = 0;

  for (const ticket of tickets) {
    const history = ticket.stageHistory || [];

    if (!history.some((entry) => stageIndex(entry.to) >= QA_ENTRY_INDEX)) continue;
    reachedQa += 1;

    const sentBack = history.some(
      (entry) => entry.to === 'in_progress'
        && entry.from
        && stageIndex(entry.from) >= QA_ENTRY_INDEX,
    );
    if (sentBack) reopenedAfterQa += 1;
  }

  return {
    reachedQa,
    reopenedAfterQa,
    // null, not 0 — "nothing reached QA" and "nothing came back" are different
    // facts, and a 0% rate over an empty denominator is a lie.
    rate: reachedQa === 0 ? null : reopenedAfterQa / reachedQa,
  };
}

export async function aging(actor, query = {}) {
  const filter = { ...buildTicketFilter(actor, query), status: { $ne: 'closed' } };

  const tickets = await Ticket.find(filter).select('createdAt').lean();

  const buckets = { '0-1': 0, '2-7': 0, '8-30': 0, '31+': 0 };
  const now = Date.now();

  for (const ticket of tickets) {
    const days = Math.floor((now - new Date(ticket.createdAt).getTime()) / DAY_MS);
    if (days <= 1) buckets['0-1'] += 1;
    else if (days <= 7) buckets['2-7'] += 1;
    else if (days <= 30) buckets['8-30'] += 1;
    else buckets['31+'] += 1;
  }

  return { buckets };
}

function weekKey(date) {
  // The Monday of that week, so buckets are stable and sort as strings.
  const d = new Date(date);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export async function trend(actor, query = {}) {
  const groupBy = query.groupBy === 'week' ? 'week' : 'day';
  const bucketOf = groupBy === 'week' ? weekKey : dayKey;
  const filter = buildTicketFilter(actor, query);

  const tickets = await Ticket.find(filter).select('createdAt closedAt').lean();

  const points = new Map();
  const touch = (bucket) => {
    if (!points.has(bucket)) points.set(bucket, { bucket, created: 0, closed: 0 });
    return points.get(bucket);
  };

  for (const ticket of tickets) {
    touch(bucketOf(ticket.createdAt)).created += 1;
    if (ticket.closedAt) touch(bucketOf(ticket.closedAt)).closed += 1;
  }

  return {
    groupBy,
    points: [...points.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
  };
}

const DRILL_FIELDS = { module: 'module', severity: 'severity', assignee: 'assignedTo' };

export async function drill(actor, query = {}) {
  const dimension = DRILL_FIELDS[query.dimension] ? query.dimension : 'severity';
  const field = DRILL_FIELDS[dimension];
  const filter = buildTicketFilter(actor, query);

  let cursor = Ticket.find(filter).select(field);
  if (dimension === 'assignee') cursor = cursor.populate('assignedTo', 'name');

  const tickets = await cursor.lean();
  const counts = new Map();

  for (const ticket of tickets) {
    const raw = dimension === 'assignee' ? ticket.assignedTo?.name : ticket[field];
    // A named empty bucket, so "no module set" is visible rather than missing.
    const key = raw || (dimension === 'assignee' ? 'Unassigned' : 'Unspecified');
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return {
    dimension,
    rows: [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
  };
}