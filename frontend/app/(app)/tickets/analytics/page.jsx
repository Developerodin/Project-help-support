'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { LANES, STAGES, stageLabel } from '@pms/shared';
import { getOverview, getTrend, getTimeInStage, getDrill } from '@/shared/api/analytics.js';
import { useProject } from '@/shared/contexts/project-context.jsx';
import { useTheme } from '@/shared/contexts/theme-context.jsx';
import FormError from '@/shared/components/form-error.jsx';

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });

export default function AnalyticsPage() {
  const { activeProjectId, activeProject } = useProject();
  const { theme } = useTheme();
  const filters = useMemo(
    () => ({ project: activeProjectId || undefined }),
    [activeProjectId],
  );
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState(null);
  const [stages, setStages] = useState(null);
  const [drill, setDrill] = useState(null);
  const [dimension, setDimension] = useState('severity');
  const [error, setError] = useState(null);

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
  if (!overview) return <p className="meta">Loading…</p>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="sub">Lane counts, time-in-stage, estimate accuracy and reopen rate — derived from stageHistory{activeProject ? ` · ${activeProject.name}` : ''}.</p>
        </div>
      </div>

      <div className="stat-grid">
        {LANES.map((lane) => (
          <div key={lane.key} className="stat-tile">
            <div className="stat-label">{lane.label}</div>
            <div className="bigfig num">{overview.lanes[lane.key]}</div>
          </div>
        ))}
        <div className="stat-tile stat-tile--alert">
          <div className="stat-label">Blocker / Critical</div>
          <div className="bigfig num">{overview.blockerCritical}</div>
        </div>
      </div>

      <p className="meta analytics-meta">
        {overview.total} tickets · lane tiles sum to the total; Blocker / Critical overlaps them.
      </p>

      <div className="panel panel-spaced">
        <header><h3>Trend</h3></header>
        {trend && (
          <Chart
            type="line"
            height={260}
            series={[
              { name: 'Created', data: trend.points.map((p) => p.created) },
              { name: 'Closed', data: trend.points.map((p) => p.closed) },
            ]}
            options={{
              chart: { toolbar: { show: false }, background: 'transparent' },
              theme: { mode: theme === 'dark' ? 'dark' : 'light' },
              stroke: { width: 2 },
              xaxis: { categories: trend.points.map((p) => p.bucket) },
            }}
          />
        )}
      </div>

      <div className="panel panel-spaced">
        <header>
          <h3>Time in stage</h3>
          <span className="spacer" />
          <span className="meta">Bottleneck: <b>{stages?.bottleneck ? stageLabel(stages.bottleneck) : '—'}</b></span>
        </header>
        {stages && (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Stage</th><th>Samples</th><th>Median (h)</th><th>p90 (h)</th></tr>
              </thead>
              <tbody>
                {STAGES.map((stage) => (
                  <tr key={stage.key}>
                    <td>{stage.label}</td>
                    <td className="t-num">{stages.byStage[stage.key].count}</td>
                    <td className="t-num">{stages.byStage[stage.key].medianHours ?? '—'}</td>
                    <td className="t-num">{stages.byStage[stage.key].p90Hours ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid2">
        <div className="panel">
          <header><h3>Estimate accuracy</h3></header>
          <p className="meta">
            {overview.estimates.measured} measurable · Early {overview.estimates.early} ·
            {' '}On time {overview.estimates.onTime} · Late {overview.estimates.late}
          </p>
        </div>
        <div className="panel">
          <header><h3>Reopen after QA</h3></header>
          <p className="meta">
            {overview.reopens.rate === null
              ? 'No tickets have reached QA yet.'
              : `${overview.reopens.reopenedAfterQa} of ${overview.reopens.reachedQa} (${Math.round(overview.reopens.rate * 100)}%)`}
          </p>
        </div>
      </div>

      <div className="panel panel-spaced-top">
        <header>
          <h3>Breakdown</h3>
          <span className="spacer" />
          <select aria-label="Dimension" value={dimension} onChange={(e) => setDimension(e.target.value)}>
            <option value="severity">By severity</option>
            <option value="module">By module</option>
            <option value="assignee">By assignee</option>
          </select>
        </header>
        {drill && (
          <ul>
            {drill.rows.map((r) => <li key={r.key} className="meta">{r.key}: {r.count}</li>)}
          </ul>
        )}
      </div>
    </>
  );
}
