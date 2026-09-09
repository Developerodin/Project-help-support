'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { LANES, STAGES, stageLabel } from '@pms/shared';
import {
  getOverview, getTrend, getDelivery, getTimeInStage, getDrill,
} from '@/shared/api/analytics.js';
import { useProject } from '@/shared/contexts/project-context.jsx';
import { useTheme } from '@/shared/contexts/theme-context.jsx';
import FormError from '@/shared/components/form-error.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });
const AGE_BUCKETS = ['0-1', '2-7', '8-30', '31+'];

export default function AnalyticsPage() {
  const { activeProjectId, activeProject } = useProject();
  const { theme } = useTheme();
  const filters = useMemo(
    () => ({ project: activeProjectId || undefined }),
    [activeProjectId],
  );
  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState(null);
  const [delivery, setDelivery] = useState(null);
  const [stages, setStages] = useState(null);
  const [drill, setDrill] = useState(null);
  const [categoryDrill, setCategoryDrill] = useState(null);
  const [severityDrill, setSeverityDrill] = useState(null);
  const [trendGroupBy, setTrendGroupBy] = useState('day');
  const [windowDays, setWindowDays] = useState(30);
  const [dimension, setDimension] = useState('severity');
  const [overlayPanel, setOverlayPanel] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    setError(null);
    Promise.all([
      getOverview(filters),
      getTrend({ ...filters, groupBy: trendGroupBy }),
      getDelivery({ ...filters, groupBy: trendGroupBy, windowDays }),
      getTimeInStage(filters),
      getDrill({ ...filters, dimension }),
      getDrill({ ...filters, dimension: 'category' }),
      getDrill({ ...filters, dimension: 'severity' }),
    ])
      .then(([o, t, dv, s, d, category, severity]) => {
        setOverview(o);
        setTrend(t);
        setDelivery(dv);
        setStages(s);
        setDrill(d);
        setCategoryDrill(category);
        setSeverityDrill(severity);
      })
      .catch(setError);
  }, [filters, trendGroupBy, windowDays, dimension]);

  useEffect(() => { reload(); }, [reload]);

  if (error) return <FormError error={error} />;
  if (
    !overview
    || !trend
    || !delivery
    || !stages
    || !drill
    || !categoryDrill
    || !severityDrill
  ) return <AppLoader inline />;

  const chartTheme = theme === 'dark' ? 'dark' : 'light';
  const stageCounts = STAGES.map((stage) => overview.byStage[stage.key] || 0);
  const estimateSeries = [
    overview.estimates.early || 0,
    overview.estimates.onTime || 0,
    overview.estimates.late || 0,
  ];
  const trendPoints = trend.points || [];
  const throughputPoints = delivery.throughput || [];
  const drillRows = drill.rows || [];
  const categoryRows = categoryDrill.rows || [];
  const severityRows = severityDrill.rows || [];
  const categoryTotal = categoryRows.reduce((sum, row) => sum + row.count, 0);
  const severityTotal = severityRows.reduce((sum, row) => sum + row.count, 0);
  const reopenRatePercent = overview.reopens.rate === null ? null : Math.round(overview.reopens.rate * 100);
  const blockedRatePercent = delivery.summary.blockedRate === null
    ? null
    : Math.round(delivery.summary.blockedRate * 100);
  const atRiskRatePercent = delivery.summary.atRiskRate === null
    ? null
    : Math.round(delivery.summary.atRiskRate * 100);
  const trendHasData = trendPoints.some((point) => point.created > 0 || point.closed > 0);
  const throughputHasData = throughputPoints.some((point) => point.live > 0 || point.closed > 0);
  const trendMarkers = trendPoints.length <= 1 ? 6 : 4;
  const throughputMarkers = throughputPoints.length <= 1 ? 6 : 4;
  const toggleOverlay = (panelKey) => setOverlayPanel((current) => (current === panelKey ? null : panelKey));
  const closeOverlay = () => setOverlayPanel(null);
  const ratio = (count, total) => (total > 0 ? `${Math.round((count / total) * 100)}%` : '0%');
  const renderOverlay = (panelKey, title, columns, rows) => {
    if (overlayPanel !== panelKey) return null;
    return (
      <div className="analytics-overlay" role="dialog" aria-label={`${title} underlying data`}>
        <div className="analytics-overlay__head">
          <strong>{title} data</strong>
          <button type="button" className="analytics-overlay-close" onClick={closeOverlay}>Close</button>
        </div>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                {columns.map((column) => <th key={column.key}>{column.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="meta">No rows for the current filters.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.__key}>
                    {columns.map((column) => (
                      <td key={`${row.__key}-${column.key}`} className={column.numeric ? 't-num' : ''}>
                        {row[column.key]}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="sub">Operational flow, quality, delivery and workload insights derived from ticket lifecycle data{activeProject ? ` · ${activeProject.name}` : ''}.</p>
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

      <div className="grid2">
        <div className="panel panel-spaced analytics-panel">
          <header>
            <h3>Stage distribution</h3>
            <span className="spacer" />
            <button type="button" className="analytics-overlay-toggle" onClick={() => toggleOverlay('stage')}>Data overlay</button>
          </header>
          <Chart
            type="bar"
            height={290}
            series={[{ name: 'Tickets', data: stageCounts }]}
            options={{
              chart: { toolbar: { show: false }, background: 'transparent' },
              theme: { mode: chartTheme },
              plotOptions: { bar: { horizontal: true, borderRadius: 3 } },
              dataLabels: { enabled: false },
              xaxis: { categories: STAGES.map((stage) => stage.label) },
            }}
          />
          {renderOverlay(
            'stage',
            'Stage distribution',
            [
              { key: 'stage', label: 'Stage' },
              { key: 'count', label: 'Tickets', numeric: true },
            ],
            STAGES.map((stage) => ({
              __key: stage.key,
              stage: stage.label,
              count: overview.byStage[stage.key] || 0,
            })),
          )}
        </div>
        <div className="panel panel-spaced analytics-panel">
          <header>
            <h3>Aging distribution</h3>
            <span className="spacer" />
            <button type="button" className="analytics-overlay-toggle" onClick={() => toggleOverlay('aging')}>Data overlay</button>
          </header>
          <Chart
            type="bar"
            height={290}
            series={[{
              name: 'Open tickets',
              data: AGE_BUCKETS.map((bucket) => overview.aging?.[bucket] || 0),
            }]}
            options={{
              chart: { toolbar: { show: false }, background: 'transparent' },
              theme: { mode: chartTheme },
              dataLabels: { enabled: false },
              xaxis: { categories: AGE_BUCKETS.map((bucket) => `${bucket} days`) },
            }}
          />
          {renderOverlay(
            'aging',
            'Aging distribution',
            [
              { key: 'bucket', label: 'Age bucket' },
              { key: 'count', label: 'Open tickets', numeric: true },
            ],
            AGE_BUCKETS.map((bucket) => ({
              __key: bucket,
              bucket: `${bucket} days`,
              count: overview.aging?.[bucket] || 0,
            })),
          )}
        </div>
      </div>

      <div className="panel panel-spaced analytics-panel">
        <header>
          <h3>Trend</h3>
          <span className="spacer" />
          <button type="button" className="analytics-overlay-toggle" onClick={() => toggleOverlay('trend')}>Data overlay</button>
          <select
            aria-label="Trend group by"
            value={trendGroupBy}
            onChange={(e) => setTrendGroupBy(e.target.value)}
          >
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
          </select>
        </header>
        {trendHasData ? (
          <Chart
            type="line"
            height={260}
            series={[
              { name: 'Created', data: trendPoints.map((p) => p.created) },
              { name: 'Closed', data: trendPoints.map((p) => p.closed) },
            ]}
            options={{
              chart: { toolbar: { show: false }, background: 'transparent' },
              theme: { mode: chartTheme },
              stroke: { width: 3, curve: 'smooth' },
              markers: { size: trendMarkers },
              yaxis: { min: 0, forceNiceScale: true },
              xaxis: { categories: trendPoints.map((p) => p.bucket) },
            }}
            width="100%"
          />
        ) : (
          <p className="meta">No created or closed activity in this range for selected filters.</p>
        )}
        {renderOverlay(
          'trend',
          'Trend',
          [
            { key: 'bucket', label: trendGroupBy === 'week' ? 'Week' : 'Day' },
            { key: 'created', label: 'Created', numeric: true },
            { key: 'closed', label: 'Closed', numeric: true },
          ],
          trendPoints.map((point) => ({
            __key: point.bucket,
            bucket: point.bucket,
            created: point.created,
            closed: point.closed,
          })),
        )}
      </div>

      <div className="grid2">
        <div className="panel panel-spaced analytics-panel">
          <header>
            <h3>Throughput</h3>
            <span className="spacer" />
            <button type="button" className="analytics-overlay-toggle" onClick={() => toggleOverlay('throughput')}>Data overlay</button>
            <select
              aria-label="Throughput window"
              value={windowDays}
              onChange={(e) => setWindowDays(Number(e.target.value))}
            >
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </header>
          {throughputHasData ? (
            <Chart
              type="line"
              height={260}
              series={[
                { name: 'Live', data: throughputPoints.map((p) => p.live) },
                { name: 'Closed', data: throughputPoints.map((p) => p.closed) },
              ]}
              options={{
                chart: { toolbar: { show: false }, background: 'transparent' },
                theme: { mode: chartTheme },
                stroke: { width: 3, curve: 'smooth' },
                markers: { size: throughputMarkers },
                yaxis: { min: 0, forceNiceScale: true },
                xaxis: { categories: throughputPoints.map((p) => p.bucket) },
              }}
              width="100%"
            />
          ) : (
            <p className="meta">No live or closed throughput in this selected window.</p>
          )}
          {renderOverlay(
            'throughput',
            'Throughput',
            [
              { key: 'bucket', label: trendGroupBy === 'week' ? 'Week' : 'Day' },
              { key: 'live', label: 'Live', numeric: true },
              { key: 'closed', label: 'Closed', numeric: true },
            ],
            throughputPoints.map((point) => ({
              __key: point.bucket,
              bucket: point.bucket,
              live: point.live,
              closed: point.closed,
            })),
          )}
        </div>
        <div className="panel panel-spaced analytics-panel">
          <header>
            <h3>Delivery health</h3>
            <span className="spacer" />
            <button type="button" className="analytics-overlay-toggle" onClick={() => toggleOverlay('delivery')}>Data overlay</button>
          </header>
          <div className="stat-grid">
            <div className="stat-tile">
              <div className="stat-label">Open</div>
              <div className="bigfig num">{delivery.summary.openTickets}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Blocked</div>
              <div className="bigfig num">{delivery.summary.blockedOpen}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">At risk</div>
              <div className="bigfig num">{delivery.summary.atRiskOpen}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-label">Total samples</div>
              <div className="bigfig num">{delivery.leadTime.samples + delivery.cycleTime.samples}</div>
            </div>
          </div>

          <div className="analytics-health-charts">
            <div className="analytics-health-chart">
              <Chart
                type="radialBar"
                height={240}
                series={[blockedRatePercent ?? 0, atRiskRatePercent ?? 0]}
                options={{
                  chart: { toolbar: { show: false }, background: 'transparent' },
                  theme: { mode: chartTheme },
                  labels: ['Blocked %', 'At risk %'],
                  legend: { show: true, position: 'bottom' },
                  plotOptions: {
                    radialBar: {
                      dataLabels: {
                        value: { formatter: (v) => `${Math.round(v)}%` },
                      },
                    },
                  },
                }}
                width="100%"
              />
            </div>
            <div className="analytics-duration-grid">
              <div className="analytics-duration-card">
                <div className="stat-label">Lead time</div>
                <div className="measure">
                  <span className="d1">M {delivery.leadTime.medianHours ?? '—'}h</span>
                  <span className="d2">P90 {delivery.leadTime.p90Hours ?? '—'}h</span>
                  <span className="d3">AVG {delivery.leadTime.averageHours ?? '—'}h</span>
                </div>
              </div>
              <div className="analytics-duration-card">
                <div className="stat-label">Cycle time</div>
                <div className="measure">
                  <span className="d1">M {delivery.cycleTime.medianHours ?? '—'}h</span>
                  <span className="d2">P90 {delivery.cycleTime.p90Hours ?? '—'}h</span>
                  <span className="d3">AVG {delivery.cycleTime.averageHours ?? '—'}h</span>
                </div>
              </div>
            </div>
          </div>

          <p className="meta">
            Lead {delivery.leadTime.medianHours ?? '—'}h median · {delivery.leadTime.p90Hours ?? '—'}h p90 · {delivery.leadTime.averageHours ?? '—'}h avg
            {' '}| Cycle {delivery.cycleTime.medianHours ?? '—'}h median · {delivery.cycleTime.p90Hours ?? '—'}h p90 · {delivery.cycleTime.averageHours ?? '—'}h avg
          </p>
          {renderOverlay(
            'delivery',
            'Delivery health',
            [
              { key: 'metric', label: 'Metric' },
              { key: 'value', label: 'Value' },
            ],
            [
              { __key: 'open', metric: 'Open tickets', value: delivery.summary.openTickets },
              { __key: 'blocked', metric: 'Blocked tickets', value: delivery.summary.blockedOpen },
              { __key: 'blocked-rate', metric: 'Blocked rate', value: blockedRatePercent === null ? '—' : `${blockedRatePercent}%` },
              { __key: 'risk', metric: 'At-risk tickets', value: delivery.summary.atRiskOpen },
              { __key: 'risk-rate', metric: 'At-risk rate', value: atRiskRatePercent === null ? '—' : `${atRiskRatePercent}%` },
              { __key: 'lead-med', metric: 'Lead median', value: `${delivery.leadTime.medianHours ?? '—'}h` },
              { __key: 'lead-p90', metric: 'Lead p90', value: `${delivery.leadTime.p90Hours ?? '—'}h` },
              { __key: 'lead-avg', metric: 'Lead average', value: `${delivery.leadTime.averageHours ?? '—'}h` },
              { __key: 'cycle-med', metric: 'Cycle median', value: `${delivery.cycleTime.medianHours ?? '—'}h` },
              { __key: 'cycle-p90', metric: 'Cycle p90', value: `${delivery.cycleTime.p90Hours ?? '—'}h` },
              { __key: 'cycle-avg', metric: 'Cycle average', value: `${delivery.cycleTime.averageHours ?? '—'}h` },
            ],
          )}
        </div>
      </div>

      <div className="grid2">
        <div className="panel panel-spaced analytics-panel">
          <header>
            <h3>Estimate accuracy</h3>
            <span className="spacer" />
            <button type="button" className="analytics-overlay-toggle" onClick={() => toggleOverlay('estimate')}>Data overlay</button>
          </header>
          {overview.estimates.measured === 0 ? (
            <p className="meta">No measurable tickets yet (needs both estimate and live transition).</p>
          ) : (
            <Chart
              type="donut"
              height={240}
              series={estimateSeries}
              options={{
                chart: { toolbar: { show: false }, background: 'transparent' },
                theme: { mode: chartTheme },
                labels: ['Early', 'On time', 'Late'],
                legend: { position: 'bottom' },
              }}
            />
          )}
          <p className="meta">
            {overview.estimates.measured} measurable · Early {overview.estimates.early}
            {' '}· On time {overview.estimates.onTime} · Late {overview.estimates.late}
          </p>
          {renderOverlay(
            'estimate',
            'Estimate accuracy',
            [
              { key: 'bucket', label: 'Bucket' },
              { key: 'count', label: 'Tickets', numeric: true },
              { key: 'share', label: 'Share' },
            ],
            [
              {
                __key: 'early',
                bucket: 'Early',
                count: overview.estimates.early || 0,
                share: ratio(overview.estimates.early || 0, overview.estimates.measured || 0),
              },
              {
                __key: 'on-time',
                bucket: 'On time',
                count: overview.estimates.onTime || 0,
                share: ratio(overview.estimates.onTime || 0, overview.estimates.measured || 0),
              },
              {
                __key: 'late',
                bucket: 'Late',
                count: overview.estimates.late || 0,
                share: ratio(overview.estimates.late || 0, overview.estimates.measured || 0),
              },
            ],
          )}
        </div>
        <div className="panel panel-spaced analytics-panel">
          <header>
            <h3>Reopen after QA</h3>
            <span className="spacer" />
            <button type="button" className="analytics-overlay-toggle" onClick={() => toggleOverlay('reopen')}>Data overlay</button>
          </header>
          {overview.reopens.rate === null ? (
            <p className="meta">No tickets have reached QA yet.</p>
          ) : (
            <Chart
              type="radialBar"
              height={240}
              series={[reopenRatePercent]}
              options={{
                chart: { toolbar: { show: false }, background: 'transparent' },
                theme: { mode: chartTheme },
                labels: ['Reopen rate'],
                plotOptions: {
                  radialBar: {
                    hollow: { size: '55%' },
                    dataLabels: { value: { formatter: (v) => `${Math.round(v)}%` } },
                  },
                },
              }}
            />
          )}
          <p className="meta">{overview.reopens.reopenedAfterQa} of {overview.reopens.reachedQa} returned from QA</p>
          {renderOverlay(
            'reopen',
            'Reopen after QA',
            [
              { key: 'metric', label: 'Metric' },
              { key: 'value', label: 'Value' },
            ],
            [
              { __key: 'reached', metric: 'Reached QA', value: overview.reopens.reachedQa },
              { __key: 'reopened', metric: 'Reopened after QA', value: overview.reopens.reopenedAfterQa },
              { __key: 'rate', metric: 'Reopen rate', value: reopenRatePercent === null ? '—' : `${reopenRatePercent}%` },
            ],
          )}
        </div>
      </div>

      <div className="panel panel-spaced analytics-panel">
        <header>
          <h3>Time in stage</h3>
          <span className="spacer" />
          <span className="meta">Bottleneck: <b>{stages.bottleneck ? stageLabel(stages.bottleneck) : '—'}</b></span>
          <button type="button" className="analytics-overlay-toggle" onClick={() => toggleOverlay('time-stage')}>Data overlay</button>
        </header>
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
        {renderOverlay(
          'time-stage',
          'Time in stage',
          [
            { key: 'stage', label: 'Stage' },
            { key: 'samples', label: 'Samples', numeric: true },
            { key: 'median', label: 'Median (h)', numeric: true },
            { key: 'p90', label: 'p90 (h)', numeric: true },
          ],
          STAGES.map((stage) => ({
            __key: stage.key,
            stage: stage.label,
            samples: stages.byStage[stage.key].count,
            median: stages.byStage[stage.key].medianHours ?? '—',
            p90: stages.byStage[stage.key].p90Hours ?? '—',
          })),
        )}
      </div>

      <div className="grid2">
        <div className="panel panel-spaced analytics-panel">
          <header>
            <h3>Category distribution</h3>
            <span className="spacer" />
            <button type="button" className="analytics-overlay-toggle" onClick={() => toggleOverlay('category')}>Data overlay</button>
          </header>
          {categoryRows.length ? (
            <Chart
              type="pie"
              height={260}
              series={categoryRows.map((row) => row.count)}
              options={{
                chart: { toolbar: { show: false }, background: 'transparent' },
                theme: { mode: chartTheme },
                labels: categoryRows.map((row) => row.key),
                legend: { position: 'bottom' },
              }}
              width="100%"
            />
          ) : (
            <p className="meta">No category data for current filters.</p>
          )}
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Category</th><th>Tickets</th><th>Share</th></tr>
              </thead>
              <tbody>
                {categoryRows.length === 0 ? (
                  <tr><td colSpan={3} className="meta">No rows for current filters.</td></tr>
                ) : (
                  categoryRows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td className="t-num">{row.count}</td>
                      <td className="t-num">{ratio(row.count, categoryTotal)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {renderOverlay(
            'category',
            'Category distribution',
            [
              { key: 'category', label: 'Category' },
              { key: 'count', label: 'Tickets', numeric: true },
              { key: 'share', label: 'Share' },
            ],
            categoryRows.map((row) => ({
              __key: row.key,
              category: row.key,
              count: row.count,
              share: ratio(row.count, categoryTotal),
            })),
          )}
        </div>
        <div className="panel panel-spaced analytics-panel">
          <header>
            <h3>Severity distribution</h3>
            <span className="spacer" />
            <button type="button" className="analytics-overlay-toggle" onClick={() => toggleOverlay('severity')}>Data overlay</button>
          </header>
          {severityRows.length ? (
            <Chart
              type="pie"
              height={260}
              series={severityRows.map((row) => row.count)}
              options={{
                chart: { toolbar: { show: false }, background: 'transparent' },
                theme: { mode: chartTheme },
                labels: severityRows.map((row) => row.key),
                legend: { position: 'bottom' },
              }}
              width="100%"
            />
          ) : (
            <p className="meta">No severity data for current filters.</p>
          )}
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Severity</th><th>Tickets</th><th>Share</th></tr>
              </thead>
              <tbody>
                {severityRows.length === 0 ? (
                  <tr><td colSpan={3} className="meta">No rows for current filters.</td></tr>
                ) : (
                  severityRows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td className="t-num">{row.count}</td>
                      <td className="t-num">{ratio(row.count, severityTotal)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {renderOverlay(
            'severity',
            'Severity distribution',
            [
              { key: 'severity', label: 'Severity' },
              { key: 'count', label: 'Tickets', numeric: true },
              { key: 'share', label: 'Share' },
            ],
            severityRows.map((row) => ({
              __key: row.key,
              severity: row.key,
              count: row.count,
              share: ratio(row.count, severityTotal),
            })),
          )}
        </div>
      </div>

      <div className="panel panel-spaced-top analytics-panel">
        <header>
          <h3>Breakdown</h3>
          <span className="spacer" />
          <button type="button" className="analytics-overlay-toggle" onClick={() => toggleOverlay('breakdown')}>Data overlay</button>
          <select aria-label="Dimension" value={dimension} onChange={(e) => setDimension(e.target.value)}>
            <option value="severity">By severity</option>
            <option value="module">By module</option>
            <option value="assignee">By assignee</option>
            <option value="team">By team</option>
            <option value="priority">By priority</option>
            <option value="category">By category</option>
            <option value="environment">By environment</option>
            <option value="label">By label</option>
          </select>
        </header>
        <Chart
          type="bar"
          height={Math.max(260, drillRows.length * 28)}
          series={[{ name: 'Tickets', data: drillRows.map((r) => r.count) }]}
          options={{
            chart: { toolbar: { show: false }, background: 'transparent' },
            theme: { mode: chartTheme },
            plotOptions: { bar: { horizontal: true, borderRadius: 3 } },
            dataLabels: { enabled: false },
            xaxis: { categories: drillRows.map((r) => r.key) },
          }}
        />
        <p className="meta">{drillRows.length} categories shown.</p>
        {renderOverlay(
          'breakdown',
          'Breakdown',
          [
            { key: 'item', label: 'Item' },
            { key: 'count', label: 'Tickets', numeric: true },
            { key: 'share', label: 'Share' },
          ],
          drillRows.map((row) => ({
            __key: row.key,
            item: row.key,
            count: row.count,
            share: ratio(row.count, overview.total || 0),
          })),
        )}
      </div>
    </>
  );
}
