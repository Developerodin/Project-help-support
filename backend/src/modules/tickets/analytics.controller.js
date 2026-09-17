import catchAsync from '../../platform/catchAsync.js';
import logger from '../../platform/logger.js';
import * as analytics from './analytics.service.js';

function logAnalytics(req, event, extra = {}) {
  logger.info(event, {
    userId: String(req.user._id),
    ...extra,
  });
}

export const overview = catchAsync(async (req, res) => {
  const started = Date.now();
  const { tickets } = await analytics.loadAnalyticsTickets(req.user, req.query);
  const tiles = analytics.computeOverview(tickets);
  logAnalytics(req, 'analytics.overview', { durationMs: Date.now() - started, ticketCount: tiles.total });

  res.json({
    ...tiles,
    estimates: analytics.computeEstimateAccuracy(tickets),
    reopens: analytics.computeReopenAfterQa(tickets),
    aging: analytics.computeAging(tickets).buckets,
  });
});

export const trend = catchAsync(async (req, res) => {
  const started = Date.now();
  const result = await analytics.trend(req.user, req.query);
  logAnalytics(req, 'analytics.trend', { durationMs: Date.now() - started });
  res.json(result);
});

export const delivery = catchAsync(async (req, res) => {
  const started = Date.now();
  const result = await analytics.delivery(req.user, req.query);
  logAnalytics(req, 'analytics.delivery', { durationMs: Date.now() - started });
  res.json(result);
});

export const timeInStage = catchAsync(async (req, res) => {
  const started = Date.now();
  const result = await analytics.timeInStage(req.user, req.query);
  logAnalytics(req, 'analytics.time_in_stage', { durationMs: Date.now() - started });
  res.json(result);
});

export const drill = catchAsync(async (req, res) => {
  const started = Date.now();
  const result = await analytics.drill(req.user, req.query);
  logAnalytics(req, 'analytics.drill', { durationMs: Date.now() - started, dimension: result.dimension });
  res.json(result);
});

export const dashboard = catchAsync(async (req, res) => {
  const started = Date.now();
  const result = await analytics.dashboard(req.user, req.query);
  logAnalytics(req, 'analytics.dashboard', {
    durationMs: Date.now() - started,
    ticketCount: result.ticketCount,
    exceedsCeiling: result.exceedsCeiling,
  });
  res.json(result);
});
