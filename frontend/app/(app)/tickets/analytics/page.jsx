'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { LANES, STAGES, stageLabel } from '@pms/shared';
import { getOverview, getTrend, getTimeInStage, getDrill } from '@/shared/api/analytics.js';
import { listProjects } from '@/shared/api/projects.js';
import FormError from '@/shared/components/form-error.jsx';

// ApexCharts touches window at import time, so it cannot be server-rendered.
const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });

export default function AnalyticsPage() {
  const [filters, setFilters] = useState({});
  const [projects, setProjects] = useState([]);
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState(null);
  const [stages, setStages] = useState(null);
  const [drill, setDrill] = useState(null);
  const [dimension, setDimension] = useState('severity');
  const [error, setError] = useState(null);

  useEffect(() => { listProjects().then((p) => setProjects(p.results)).catch(() => {}); }, []);

  const reload = useCallback(() => {
    setError(null);
    Promise.all([
      getOverview(filters),
      getTrend({ ...filters, groupBy: 'day' }),
      getTimeInStage(filters),
      getDrill({ ...filters, dimension }),
    ])
      .then(([o, t, s, d]) => { setOverview(o); setTrend(t); setStages(s); setDrill(d); })
      .catch(setError);
  }, [filters, dimension]);

  useEffect(() => { reload(); }, [reload]);

  if (error) return <FormError error={error} />;
  if (!overview) return <p>Loading…</p>;

  return (
    <>
      <h1>Analytics</h1>

      <select
        aria-label="Project"
        value={filters.project || ''}
        onChange={(e) => setFilters({ ...filters, project: e.target.value || undefined })}
      >
        <option value="">All projects</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      {/* The tiles follow the board lanes, so the two always agree. */}
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        {LANES.map((lane) => (
          <div key={lane.key} style={{ flex: 1, padding: 12, border: '1px solid var(--border)' }}>
            <div style={{ color: 'var(--muted)' }}>{lane.label}</div>
            <strong style={{ fontSize: 22 }}>{overview.lanes[lane.key]}</strong>
          </div>
        ))}
        <div style={{ flex: 1, padding: 12, border: '1px solid var(--danger)' }}>
          <div style={{ color: 'var(--muted)' }}>Blocker / Critical</div>
          <strong style={{ fontSize: 22 }}>{overview.blockerCritical}</strong>
        </div>
      </div>

      <p style={{ color: 'var(--muted)' }}>
        {overview.total} tickets · the lane tiles sum to the total; Blocker / Critical overlaps them.
      </p>

      <h2>Trend</h2>
      {trend && (
        <Chart
          type="line"
          height={260}
          series={[
            { name: 'Created', data: trend.points.map((p) => p.created) },
            { name: 'Closed', data: trend.points.map((p) => p.closed) },
          ]}
          options={{
            chart: { toolbar: { show: false } },
            xaxis: { categories: trend.points.map((p) => p.bucket) },
          }}
        />
      )}

      <h2>Time in stage</h2>
      {stages && (
        <>
          <p>
            Bottleneck: <strong>{stages.bottleneck ? stageLabel(stages.bottleneck) : '—'}</strong>
          </p>
          <table>
            <thead>
              <tr><th>Stage</th><th>Samples</th><th>Median (h)</th><th>p90 (h)</th></tr>
            </thead>
            <tbody>
              {STAGES.map((stage) => (
                <tr key={stage.key}>
                  <td>{stage.label}</td>
                  <td>{stages.byStage[stage.key].count}</td>
                  <td>{stages.byStage[stage.key].medianHours ?? '—'}</td>
                  <td>{stages.byStage[stage.key].p90Hours ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Estimate accuracy</h2>
      <p>
        {overview.estimates.measured} measurable · Early {overview.estimates.early} ·
        {' '}On time {overview.estimates.onTime} · Late {overview.estimates.late}
      </p>

      <h2>Reopen after QA</h2>
      <p>
        {overview.reopens.rate === null
          ? 'No tickets have reached QA yet.'
          : `${overview.reopens.reopenedAfterQa} of ${overview.reopens.reachedQa} (${Math.round(overview.reopens.rate * 100)}%)`}
      </p>

      <h2>Aging (open tickets)</h2>
      <p>
        {Object.entries(overview.aging).map(([bucket, count]) => `${bucket}d: ${count}`).join(' · ')}
      </p>

      <h2>Breakdown</h2>
      <select
        aria-label="Dimension"
        value={dimension}
        onChange={(e) => setDimension(e.target.value)}
      >
        <option value="severity">By severity</option>
        <option value="module">By module</option>
        <option value="assignee">By assignee</option>
      </select>
      {drill && <ul>{drill.rows.map((r) => <li key={r.key}>{r.key}: {r.count}</li>)}</ul>}
    </>
  );
}
