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
  const filter = await buildTicketFilter(actor, query);

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

export function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
  const filter = await buildTicketFilter(actor, query);

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
  const filter = await buildTicketFilter(actor, query);

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
  const filter = await buildTicketFilter(actor, query);

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
  const filter = { ...(await buildTicketFilter(actor, query)), status: { $ne: 'closed' } };

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
  const filter = await buildTicketFilter(actor, query);

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

const clampWindowDays = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(7, Math.min(90, parsed));
};

const toHours = (ms) => Number((ms / HOUR_MS).toFixed(2));

const durationStats = (values) => {
  const medianMs = median(values);
  const p90Ms = percentile(values, 0.9);
  const averageMs = average(values);

  return {
    samples: values.length,
    medianHours: medianMs === null ? null : toHours(medianMs),
    p90Hours: p90Ms === null ? null : toHours(p90Ms),
    averageHours: averageMs === null ? null : toHours(averageMs),
  };
};

export async function delivery(actor, query = {}) {
  const groupBy = query.groupBy === 'week' ? 'week' : 'day';
  const bucketOf = groupBy === 'week' ? weekKey : dayKey;
  const windowDays = clampWindowDays(query.windowDays);
  const filter = await buildTicketFilter(actor, query);

  const tickets = await Ticket.find(filter)
    .select('createdAt closedAt status blocked estimatedResolutionAt stageHistory')
    .lean();

  const leadSamples = [];
  const cycleSamples = [];
  const nowMs = Date.now();
  const cutoffMs = nowMs - (windowDays * DAY_MS);

  let openTickets = 0;
  let blockedOpen = 0;
  let atRiskOpen = 0;

  const throughput = new Map();
  const touch = (bucket) => {
    if (!throughput.has(bucket)) throughput.set(bucket, { bucket, live: 0, closed: 0 });
    return throughput.get(bucket);
  };

  for (const ticket of tickets) {
    const createdMs = new Date(ticket.createdAt).getTime();
    const closedMs = ticket.closedAt ? new Date(ticket.closedAt).getTime() : null;
    const history = ticket.stageHistory || [];

    if (ticket.status !== 'closed') {
      openTickets += 1;
      if (ticket.blocked) blockedOpen += 1;

      if (ticket.estimatedResolutionAt) {
        const estimateMs = new Date(ticket.estimatedResolutionAt).getTime();
        if (estimateMs < nowMs) atRiskOpen += 1;
      }
    }

    if (closedMs !== null) {
      const leadMs = closedMs - createdMs;
      if (leadMs >= 0) leadSamples.push(leadMs);
      if (closedMs >= cutoffMs) touch(bucketOf(ticket.closedAt)).closed += 1;
    }

    const started = history.find((entry) => entry.to === 'in_progress');
    const wentLive = history.find((entry) => entry.to === 'live');
    if (started && wentLive) {
      const cycleMs = new Date(wentLive.at).getTime() - new Date(started.at).getTime();
      if (cycleMs >= 0) cycleSamples.push(cycleMs);
    }

    if (wentLive) {
      const liveMs = new Date(wentLive.at).getTime();
      if (liveMs >= cutoffMs) touch(bucketOf(wentLive.at)).live += 1;
    }
  }

  return {
    groupBy,
    windowDays,
    summary: {
      openTickets,
      blockedOpen,
      atRiskOpen,
      blockedRate: openTickets === 0 ? null : blockedOpen / openTickets,
      atRiskRate: openTickets === 0 ? null : atRiskOpen / openTickets,
    },
    leadTime: durationStats(leadSamples),
    cycleTime: durationStats(cycleSamples),
    throughput: [...throughput.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)),
  };
}

const DRILL_FIELDS = {
  severity: 'severity',
  module: 'module',
  assignee: 'assignedTo',
  team: 'team',
  priority: 'priority',
  category: 'category',
  environment: 'environment',
  label: 'labels',
};

export async function drill(actor, query = {}) {
  const dimension = DRILL_FIELDS[query.dimension] ? query.dimension : 'severity';
  const field = DRILL_FIELDS[dimension];
  const filter = await buildTicketFilter(actor, query);

  let cursor = Ticket.find(filter).select(field);
  if (dimension === 'assignee') cursor = cursor.populate('assignedTo', 'name');
  if (dimension === 'team') cursor = cursor.populate('team', 'name');

  const tickets = await cursor.lean();
  const counts = new Map();

  for (const ticket of tickets) {
    if (dimension === 'assignee') {
      const key = ticket.assignedTo?.name || 'Unassigned';
      counts.set(key, (counts.get(key) || 0) + 1);
      continue;
    }

    if (dimension === 'team') {
      const key = ticket.team?.name || 'No Team';
      counts.set(key, (counts.get(key) || 0) + 1);
      continue;
    }

    if (dimension === 'label') {
      const labels = Array.isArray(ticket.labels)
        ? ticket.labels.map((label) => String(label).trim()).filter(Boolean)
        : [];

      if (!labels.length) {
        counts.set('No Label', (counts.get('No Label') || 0) + 1);
        continue;
      }

      for (const label of labels) {
        counts.set(label, (counts.get(label) || 0) + 1);
      }
      continue;
    }

    const raw = ticket[field];
    // A named empty bucket, so missing fields are visible rather than absent.
    const key = raw || 'Unspecified';
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return {
    dimension,
    rows: [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
  };
}