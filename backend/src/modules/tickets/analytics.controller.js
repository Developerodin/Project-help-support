import catchAsync from '../../platform/catchAsync.js';
import * as analytics from './analytics.service.js';

export const overview = catchAsync(async (req, res) => {
  // One round trip for the whole header of the page: four independent reads,
  // all against the same filter, issued together.
  const [tiles, estimates, reopens, ages] = await Promise.all([
    analytics.overview(req.user, req.query),
    analytics.estimateAccuracy(req.user, req.query),
    analytics.reopenAfterQa(req.user, req.query),
    analytics.aging(req.user, req.query),
  ]);

  res.json({ ...tiles, estimates, reopens, aging: ages.buckets });
});

export const trend = catchAsync(async (req, res) => {
  res.json(await analytics.trend(req.user, req.query));
});

export const delivery = catchAsync(async (req, res) => {
  res.json(await analytics.delivery(req.user, req.query));
});

export const timeInStage = catchAsync(async (req, res) => {
  res.json(await analytics.timeInStage(req.user, req.query));
});

export const drill = catchAsync(async (req, res) => {
  res.json(await analytics.drill(req.user, req.query));
});