import { apiFetch } from './client.js';

const query = (params = {}) => {
  const search = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  ).toString();
  return search ? `?${search}` : '';
};

export const getOverview = (params) => apiFetch(`/analytics/overview${query(params)}`);
export const getTrend = (params) => apiFetch(`/analytics/trend${query(params)}`);
export const getDelivery = (params) => apiFetch(`/analytics/delivery${query(params)}`);
export const getTimeInStage = (params) => apiFetch(`/analytics/time-in-stage${query(params)}`);
export const getDrill = (params) => apiFetch(`/analytics/drill${query(params)}`);
