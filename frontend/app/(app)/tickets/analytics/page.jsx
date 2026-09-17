'use client';

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  LANES, STAGES, stageLabel, laneEntryStage,
} from '@pms/shared';
import {
  getDashboard, getTrend, getDelivery, getDrill,
} from '@/shared/api/analytics.js';
import { useProject } from '@/shared/contexts/project-context.jsx';
import { useTheme } from '@/shared/contexts/theme-context.jsx';
import FormError from '@/shared/components/form-error.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';
import { useHistorySearch } from '@/shared/lib/use-history-search.js';
import {
  analyticsViewFromSearch,
  withAnalyticsViewParams,
  analyticsDrillListHref,
} from '@/shared/lib/analytics-query.js';
import { resolveViewProject } from '@/shared/lib/ticket-list-query.js';

const Chart = dynamic(() => import('react-apexcharts'), { ssr: false });
const AGE_BUCKETS = ['0-1', '2-7', '8-30', '31+'];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return reduced;
}

function TisMiniRow({
  label, medianHours, p90Hours, scaleMax, isBottleneck,
}) {
  const medPct = scaleMax > 0 && medianHours != null
    ? Math.min(100, (medianHours / scaleMax) * 100)
    : 0;
  const p90Pct = scaleMax > 0 && p90Hours != null
    ? Math.min(100, (p90Hours / scaleMax) * 100)
    : null;
  const ariaLabel = [
    label,
    isBottleneck ? 'bottleneck stage' : null,
    medianHours != null ? `median ${medianHours} hours` : 'median unavailable',
    p90Hours != null ? `p90 ${p90Hours} hours` : null,
  ].filter(Boolean).join(', ');

  return (
    <div className="tis" role="group" aria-label={ariaLabel}>
      <span className="s" title={label}>
        {isBottleneck ? (
          <>
            {label}
            {' '}
            <span className="analytics-tis-bottleneck-tag">(bottleneck)</span>
          </>
        ) : label}
      </span>
      <div className="track" aria-hidden="true">
        <span className="med" style={{ width: `${medPct}%` }} />
        {p90Pct != null ? (
          <span className="p90" style={{ left: `${p90Pct}%` }} />
        ) : null}
      </div>
      <span className="v">
        <span className="t-num">{medianHours ?? '—'}</span>
        h
        {' '}
        <em>
          p90
          {' '}
          <span className="t-num">{p90Hours ?? '—'}</span>
        </em>
      </span>
    </div>
  );
}

function PanelShell({
  title,
  subtitle,
  className = '',
  id,
  loading,
  error,
  onRetry,
  children,
  headerExtra,
}) {
  return (
    <div
      id={id}
      className={`panel panel-spaced analytics-panel ${className}`.trim()}
    >
      <header>
        <h3>{title}</h3>
        <span className="spacer" />
        {headerExtra}
      </header>
      {subtitle ? <p className="note-line analytics-panel-subtitle">{subtitle}</p> : null}
      {error ? (
        <div className="analytics-panel-error">
          <FormError error={error} />
          <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>Retry</button>
        </div>
      ) : null}
      {loading && !children ? <AppLoader inline /> : children}
    </div>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const searchString = useHistorySearch();
  const view = useMemo(() => analyticsViewFromSearch(searchString), [searchString]);
  const { activeProjectId, activeProject } = useProject();
  const { theme } = useTheme();
  const prefersReducedMotion = usePrefersReducedMotion();
  const overlayToggleRef = useRef(null);
  const overlayCloseRef = useRef(null);
  const skipSectionFetch = useRef(true);

  const projectId = resolveViewProject(searchString, activeProjectId);
  const filters = useMemo(
    () => ({ project: projectId || undefined }),
    [projectId],
  );

  const [overview, setOverview] = useState(null);
  const [trend, setTrend] = useState(null);
  const [delivery, setDelivery] = useState(null);
  const [stages, setStages] = useState(null);
  const [drill, setDrill] = useState(null);
  const [categoryDrill, setCategoryDrill] = useState(null);
  const [severityDrill, setSeverityDrill] = useState(null);
  const [ceilingMeta, setCeilingMeta] = useState(null);

  const [bundleLoading, setBundleLoading] = useState(true);
  const [bundleError, setBundleError] = useState(null);
  const [trendError, setTrendError] = useState(null);
  const [deliveryError, setDeliveryError] = useState(null);
  const [drillError, setDrillError] = useState(null);

  const [overlayPanel, setOverlayPanel] = useState(null);

  const pushView = useCallback((patch) => {
    const next = withAnalyticsViewParams(searchString, patch);
    router.replace(`/tickets/analytics${next}`);
  }, [router, searchString]);

  const loadBundle = useCallback(() => {
    setBundleError(null);
    setBundleLoading(true);
    const currentView = analyticsViewFromSearch(
      typeof window !== 'undefined' ? window.location.search : searchString,
    );
    return getDashboard({
      ...filters,
      trendGroupBy: currentView.trendGroupBy,
      deliveryGroupBy: currentView.deliveryGroupBy,
      windowDays: currentView.windowDays,
      dimension: currentView.dimension,
    })
      .then((data) => {
        setOverview(data.overview);
        setTrend(data.trend);
        setDelivery(data.delivery);
        setStages(data.timeInStage);
        setDrill(data.drill);
        setCategoryDrill(data.categoryDrill);
        setSeverityDrill(data.severityDrill);
        setCeilingMeta({
          ticketCount: data.ticketCount,
          exceedsCeiling: data.exceedsCeiling,
          ceiling: data.ceiling,
        });
      })
      .catch(setBundleError)
      .finally(() => setBundleLoading(false));
  }, [filters, searchString]);

  useEffect(() => {
    skipSectionFetch.current = true;
    loadBundle();
  }, [loadBundle]);

  useEffect(() => {
    if (bundleLoading || bundleError || !overview) return;
    if (skipSectionFetch.current) {
      skipSectionFetch.current = false;
      return;
    }
    setTrendError(null);
    setDeliveryError(null);
    setDrillError(null);
    getTrend({ ...filters, groupBy: view.trendGroupBy })
      .then(setTrend)
      .catch(setTrendError);
    getDelivery({
      ...filters,
      groupBy: view.deliveryGroupBy,
      windowDays: view.windowDays,
    })
      .then(setDelivery)
      .catch(setDeliveryError);
    getDrill({ ...filters, dimension: view.dimension })
      .then(setDrill)
      .catch(setDrillError);
  }, [
    view.trendGroupBy,
    view.deliveryGroupBy,
    view.windowDays,
    view.dimension,
    filters,
    bundleLoading,
    bundleError,
    overview,
  ]);

  useEffect(() => {
    if (!overlayPanel) return undefined;
    const previousFocus = document.activeElement;
    overlayCloseRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOverlayPanel(null);
        return;
      }
      if (event.key !== 'Tab' || !overlayCloseRef.current) return;
      const focusables = overlayCloseRef.current.closest('.analytics-overlay')
        ?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusables?.length) return;
      const list = [...focusables];
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [overlayPanel]);

  const chartTheme = theme === 'dark' ? 'dark' : 'light';
  const chartBase = useMemo(() => ({
    chart: {
      toolbar: { show: false },
      background: 'transparent',
      animations: prefersReducedMotion ? { enabled: false } : { enabled: true },
    },
    theme: { mode: chartTheme },
  }), [chartTheme, prefersReducedMotion]);

  if (bundleLoading && !overview) return <AppLoader inline />;
  if (bundleError && !overview) {
    return (
      <div className="analytics-page-error">
        <FormError error={bundleError} />
        <button type="button" className="btn btn--ghost" onClick={loadBundle}>Retry</button>
      </div>
    );
  }

  const stageCounts = STAGES.map((stage) => overview.byStage[stage.key] || 0);
  const estimateSeries = [
    overview.estimates.early || 0,
    overview.estimates.onTime || 0,
    overview.estimates.late || 0,
  ];
  const trendPoints = trend?.points || [];
  const throughputPoints = delivery?.throughput || [];
  const drillRows = drill?.rows || [];
  const categoryRows = categoryDrill?.rows || [];
  const severityRows = severityDrill?.rows || [];
  const categoryTotal = categoryRows.reduce((sum, row) => sum + row.count, 0);
  const severityTotal = severityRows.reduce((sum, row) => sum + row.count, 0);
  const reopenRatePercent = overview.reopens.rate === null ? null : Math.round(overview.reopens.rate * 100);
  const blockedRatePercent = delivery?.summary?.blockedRate === null
    ? null
    : Math.round(delivery.summary.blockedRate * 100);
  const atRiskRatePercent = delivery?.summary?.atRiskRate === null
    ? null
    : Math.round(delivery.summary.atRiskRate * 100);
  const trendHasData = trendPoints.some((point) => point.created > 0 || point.closed > 0);
  const throughputHasData = throughputPoints.some((point) => point.live > 0 || point.closed > 0);
  const trendMarkers = trendPoints.length <= 1 ? 6 : 4;
  const throughputMarkers = throughputPoints.length <= 1 ? 6 : 4;
  const deliveryGroupBy = delivery?.groupBy || view.deliveryGroupBy;

  const timeInStageTopRows = stages?.byStage
    ? STAGES
      .map((stage) => ({
        key: stage.key,
        label: stage.label,
        ...stages.byStage[stage.key],
      }))
      .filter((row) => row.count > 0 && row.medianHours != null)
      .sort((a, b) => (b.medianHours ?? 0) - (a.medianHours ?? 0))
      .slice(0, 6)
    : [];
  const timeInStageSampleTotal = stages?.byStage
    ? STAGES.reduce((sum, stage) => sum + (stages.byStage[stage.key]?.count || 0), 0)
    : 0;
  const timeInStageScaleMax = timeInStageTopRows.reduce(
    (max, row) => Math.max(max, row.p90Hours ?? row.medianHours ?? 0),
    0,
  ) || 1;
  const bottleneckStageKey = stages?.bottleneck ?? null;
  const bottleneckStageLabel = bottleneckStageKey ? stageLabel(bottleneckStageKey) : null;

  const toggleOverlay = (panelKey) => {
    overlayToggleRef.current = document.activeElement;
    setOverlayPanel((current) => (current === panelKey ? null : panelKey));
  };
  const closeOverlay = () => setOverlayPanel(null);
  const ratio = (count, total) => (total > 0 ? `${Math.round((count / total) * 100)}%` : '0%');
  const listHref = (params) => analyticsDrillListHref({ projectId, ...params });

  const renderOverlay = (panelKey, title, columns, rows) => {
    if (overlayPanel !== panelKey) return null;
    return (
      <div
        className="analytics-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} underlying data`}
      >
        <div className="analytics-overlay__head">
          <strong>{title} data</strong>
          <button
            type="button"
            ref={overlayCloseRef}
            className="analytics-overlay-close"
            onClick={closeOverlay}
          >
            Close
          </button>
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

  const overlayToggle = (panelKey, label = 'View table') => (
    <button
      type="button"
      className="analytics-overlay-toggle"
      aria-expanded={overlayPanel === panelKey}
      aria-controls={overlayPanel === panelKey ? `${panelKey}-overlay` : undefined}
      onClick={() => toggleOverlay(panelKey)}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="sub">
            Operational flow, quality, delivery and workload insights derived from ticket lifecycle data
            {activeProject ? ` · ${activeProject.name}` : ''}.
          </p>
        </div>
      </div>

      {ceilingMeta?.exceedsCeiling ? (
        <div className="analytics-ceiling-banner" role="status">
          {ceilingMeta.ticketCount.toLocaleString()} tickets exceed the recommended ceiling of
          {' '}{ceilingMeta.ceiling.toLocaleString()}. Metrics may be slow or less precise; consider narrowing filters.
        </div>
      ) : null}

      <div className="stat-grid">
        {LANES.map((lane) => (
          <Link
            key={lane.key}
            href={listHref({ status: laneEntryStage(lane.key) })}
            className="stat-tile stat-tile--link"
          >
            <div className="stat-label" title={`Tickets in ${lane.label} stages`}>{lane.label}</div>
            <div className="bigfig num">{overview.lanes[lane.key]}</div>
          </Link>
        ))}
        <div className="stat-tile stat-tile--alert">
          <div className="stat-label" title="Critical or Blocker severity; counted in lane tiles too">Blocker / Critical</div>
          <div className="bigfig num">{overview.blockerCritical}</div>
        </div>
      </div>

      <p className="meta analytics-meta">
        {overview.total} tickets · lane tiles sum to the total; Blocker / Critical overlaps them.
      </p>

      <div className="grid2 analytics-distribution-grid">
        <PanelShell title="Stage distribution" headerExtra={overlayToggle('stage')}>
          <Chart
            type="bar"
            height={290}
            series={[{ name: 'Tickets', data: stageCounts }]}
            options={{
              ...chartBase,
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
          <div className="tablewrap analytics-inline-table">
            <table>
              <tbody>
                {STAGES.map((stage) => (
                  <tr key={stage.key}>
                    <td><Link href={listHref({ status: stage.key })}>{stage.label}</Link></td>
                    <td className="t-num">{overview.byStage[stage.key] || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelShell>
        <div className="analytics-distribution-stack">
          <PanelShell
            title="Aging distribution"
            subtitle="Open tickets only · days in current stage."
            className="analytics-panel--compact"
            headerExtra={overlayToggle('aging')}
          >
            <Chart
              type="bar"
              height={200}
              series={[{
                name: 'Open tickets',
                data: AGE_BUCKETS.map((bucket) => overview.aging?.[bucket] || 0),
              }]}
              options={{
                ...chartBase,
                plotOptions: { bar: { horizontal: true, borderRadius: 3 } },
                dataLabels: {
                  enabled: true,
                  style: { fontSize: '11px', fontWeight: 600 },
                },
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
          </PanelShell>
          <PanelShell
            title="Time in stage (summary)"
            subtitle="Median dwell time from stage history · top stages by median hours."
            className="analytics-panel--compact analytics-panel--tis-summary"
          >
            {!stages ? (
              <p className="meta analytics-empty">Time-in-stage data unavailable.</p>
            ) : timeInStageSampleTotal === 0 ? (
              <p className="meta analytics-empty">
                No stage intervals recorded yet for these filters. Metrics appear after tickets move
                through stages.
              </p>
            ) : (
              <>
                {bottleneckStageLabel ? (
                  <p className="analytics-tis-callout" role="status">
                    Bottleneck stage (longest median time):
                    {' '}
                    <strong>{bottleneckStageLabel}</strong>
                  </p>
                ) : null}
                <div className="analytics-tis-list">
                  {timeInStageTopRows.map((row) => (
                    <TisMiniRow
                      key={row.key}
                      label={row.label}
                      medianHours={row.medianHours}
                      p90Hours={row.p90Hours}
                      scaleMax={timeInStageScaleMax}
                      isBottleneck={row.key === bottleneckStageKey}
                    />
                  ))}
                </div>
                <p className="analytics-tis-foot">
                  <a href="#analytics-time-in-stage" className="analytics-tis-jump">
                    View full breakdown
                  </a>
                </p>
              </>
            )}
          </PanelShell>
        </div>
      </div>

      <PanelShell
        title="Trend"
        error={trendError}
        onRetry={() => getTrend({ ...filters, groupBy: view.trendGroupBy }).then(setTrend).catch(setTrendError)}
        headerExtra={(
          <>
            {overlayToggle('trend')}
            <select
              aria-label="Trend group by"
              value={view.trendGroupBy}
              onChange={(e) => pushView({ trendGroupBy: e.target.value })}
            >
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
            </select>
          </>
        )}
      >
        <p className="meta analytics-utc-note">Time buckets use UTC.</p>
        {trendHasData ? (
          <Chart
            type="line"
            height={260}
            series={[
              { name: 'Created', data: trendPoints.map((p) => p.created) },
              { name: 'Closed', data: trendPoints.map((p) => p.closed) },
            ]}
            options={{
              ...chartBase,
              stroke: { width: 3, curve: 'smooth' },
              markers: { size: trendMarkers },
              yaxis: { min: 0, forceNiceScale: true },
              xaxis: { categories: trendPoints.map((p) => p.bucket) },
            }}
            width="100%"
          />
        ) : (
          <p className="meta analytics-empty">No created or closed activity in this range for selected filters.</p>
        )}
        {renderOverlay(
          'trend',
          'Trend',
          [
            { key: 'bucket', label: view.trendGroupBy === 'week' ? 'Week' : 'Day' },
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
      </PanelShell>

      <div className="grid2">
        <PanelShell
          title="Throughput"
          error={deliveryError}
          onRetry={() => getDelivery({
            ...filters,
            groupBy: view.deliveryGroupBy,
            windowDays: view.windowDays,
          }).then(setDelivery).catch(setDeliveryError)}
          headerExtra={(
            <>
              {overlayToggle('throughput')}
              <select
                aria-label="Throughput group by"
                value={view.deliveryGroupBy}
                onChange={(e) => pushView({ deliveryGroupBy: e.target.value })}
              >
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
              </select>
              <select
                aria-label="Throughput window"
                value={view.windowDays}
                onChange={(e) => pushView({ windowDays: Number(e.target.value) })}
              >
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
                <option value={60}>Last 60 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </>
          )}
        >
          <p className="meta analytics-utc-note">Throughput buckets use UTC.</p>
          {throughputHasData ? (
            <Chart
              type="line"
              height={260}
              series={[
                { name: 'Live', data: throughputPoints.map((p) => p.live) },
                { name: 'Closed', data: throughputPoints.map((p) => p.closed) },
              ]}
              options={{
                ...chartBase,
                stroke: { width: 3, curve: 'smooth' },
                markers: { size: throughputMarkers },
                yaxis: { min: 0, forceNiceScale: true },
                xaxis: { categories: throughputPoints.map((p) => p.bucket) },
              }}
              width="100%"
            />
          ) : (
            <p className="meta analytics-empty">No live or closed throughput in this selected window.</p>
          )}
          {renderOverlay(
            'throughput',
            'Throughput',
            [
              { key: 'bucket', label: deliveryGroupBy === 'week' ? 'Week' : 'Day' },
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
        </PanelShell>
        <PanelShell title="Delivery health" headerExtra={overlayToggle('delivery')}>
          {delivery ? (
            <>
              <div className="stat-grid">
                <div className="stat-tile">
                  <div className="stat-label" title="Tickets not in closed status">Open</div>
                  <div className="bigfig num">{delivery.summary.openTickets}</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-label" title="Open tickets marked blocked">Blocked</div>
                  <div className="bigfig num">{delivery.summary.blockedOpen}</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-label" title="Open tickets past estimated resolution">At risk</div>
                  <div className="bigfig num">{delivery.summary.atRiskOpen}</div>
                </div>
                <div className="stat-tile">
                  <div className="stat-label" title="Completed intervals used for lead and cycle time stats">
                    Duration samples
                  </div>
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
                      ...chartBase,
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
                Lead {delivery.leadTime.medianHours ?? '—'}h median · {delivery.leadTime.p90Hours ?? '—'}h p90
                {' '}| Cycle {delivery.cycleTime.medianHours ?? '—'}h median · {delivery.cycleTime.p90Hours ?? '—'}h p90
              </p>
            </>
          ) : (
            <p className="meta analytics-empty">Delivery metrics unavailable.</p>
          )}
          {delivery ? renderOverlay(
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
            ],
          ) : null}
        </PanelShell>
      </div>

      <div className="grid2">
        <PanelShell title="Estimate accuracy" headerExtra={overlayToggle('estimate')}>
          {overview.estimates.measured === 0 ? (
            <p className="meta analytics-empty">No measurable tickets yet (needs both estimate and live transition).</p>
          ) : (
            <Chart
              type="donut"
              height={240}
              series={estimateSeries}
              options={{
                ...chartBase,
                labels: ['Early', 'On time', 'Late'],
                legend: { position: 'bottom' },
              }}
            />
          )}
          {renderOverlay(
            'estimate',
            'Estimate accuracy',
            [
              { key: 'bucket', label: 'Bucket' },
              { key: 'count', label: 'Tickets', numeric: true },
            ],
            [
              { __key: 'early', bucket: 'Early', count: overview.estimates.early || 0 },
              { __key: 'on-time', bucket: 'On time', count: overview.estimates.onTime || 0 },
              { __key: 'late', bucket: 'Late', count: overview.estimates.late || 0 },
            ],
          )}
        </PanelShell>
        <PanelShell title="Reopen after QA" headerExtra={overlayToggle('reopen')}>
          {overview.reopens.rate === null ? (
            <p className="meta analytics-empty">No tickets have reached QA yet.</p>
          ) : (
            <Chart
              type="radialBar"
              height={240}
              series={[reopenRatePercent]}
              options={{
                ...chartBase,
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
        </PanelShell>
      </div>

      <PanelShell
        id="analytics-time-in-stage"
        title="Time in stage"
        headerExtra={(
          <>
            <span className="meta">Bottleneck: <b>{stages?.bottleneck ? stageLabel(stages.bottleneck) : '—'}</b></span>
            {overlayToggle('time-stage')}
          </>
        )}
      >
        {stages ? (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Stage</th><th>Samples</th><th>Median (h)</th><th>p90 (h)</th></tr>
              </thead>
              <tbody>
                {STAGES.map((stage) => (
                  <tr key={stage.key}>
                    <td><Link href={listHref({ status: stage.key })}>{stage.label}</Link></td>
                    <td className="t-num">{stages.byStage[stage.key].count}</td>
                    <td className="t-num">{stages.byStage[stage.key].medianHours ?? '—'}</td>
                    <td className="t-num">{stages.byStage[stage.key].p90Hours ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="meta analytics-empty">Time-in-stage data unavailable.</p>
        )}
      </PanelShell>

      <div className="grid2">
        <PanelShell title="Category distribution" headerExtra={overlayToggle('category')}>
          {categoryRows.length ? (
            <Chart
              type="pie"
              height={260}
              series={categoryRows.map((row) => row.count)}
              options={{
                ...chartBase,
                labels: categoryRows.map((row) => row.key),
                legend: { position: 'bottom' },
              }}
              width="100%"
            />
          ) : (
            <p className="meta analytics-empty">No category data for current filters.</p>
          )}
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Category</th><th>Tickets</th><th>Share</th></tr>
              </thead>
              <tbody>
                {categoryRows.map((row) => (
                  <tr key={row.key}>
                    <td><Link href={listHref({ dimension: 'category', rowKey: row.key })}>{row.key}</Link></td>
                    <td className="t-num">{row.count}</td>
                    <td className="t-num">{ratio(row.count, categoryTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelShell>
        <PanelShell title="Severity distribution" headerExtra={overlayToggle('severity')}>
          {severityRows.length ? (
            <Chart
              type="pie"
              height={260}
              series={severityRows.map((row) => row.count)}
              options={{
                ...chartBase,
                labels: severityRows.map((row) => row.key),
                legend: { position: 'bottom' },
              }}
              width="100%"
            />
          ) : (
            <p className="meta analytics-empty">No severity data for current filters.</p>
          )}
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Severity</th><th>Tickets</th><th>Share</th></tr>
              </thead>
              <tbody>
                {severityRows.map((row) => (
                  <tr key={row.key}>
                    <td><Link href={listHref({ dimension: 'severity', rowKey: row.key })}>{row.key}</Link></td>
                    <td className="t-num">{row.count}</td>
                    <td className="t-num">{ratio(row.count, severityTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelShell>
      </div>

      <PanelShell
        title="Breakdown"
        error={drillError}
        onRetry={() => getDrill({ ...filters, dimension: view.dimension }).then(setDrill).catch(setDrillError)}
        headerExtra={(
          <>
            {overlayToggle('breakdown')}
            <select
              aria-label="Dimension"
              value={view.dimension}
              onChange={(e) => pushView({ dimension: e.target.value })}
            >
              <option value="severity">By severity</option>
              <option value="module">By module</option>
              <option value="assignee">By assignee</option>
              <option value="team">By team</option>
              <option value="priority">By priority</option>
              <option value="category">By category</option>
              <option value="environment">By environment</option>
              <option value="label">By label</option>
            </select>
          </>
        )}
      >
        {view.dimension === 'label' ? (
          <p className="meta">Tickets with multiple labels are counted once per label; shares can exceed 100%.</p>
        ) : null}
        {drillRows.length ? (
          <Chart
            type="bar"
            height={Math.max(260, drillRows.length * 28)}
            series={[{ name: 'Tickets', data: drillRows.map((r) => r.count) }]}
            options={{
              ...chartBase,
              plotOptions: { bar: { horizontal: true, borderRadius: 3 } },
              dataLabels: { enabled: false },
              xaxis: { categories: drillRows.map((r) => r.key) },
            }}
          />
        ) : (
          <p className="meta analytics-empty">No breakdown data for current filters.</p>
        )}
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Item</th><th>Tickets</th><th>Share</th></tr>
            </thead>
            <tbody>
              {drillRows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <Link href={listHref({ dimension: view.dimension, rowKey: row.key })}>{row.key}</Link>
                  </td>
                  <td className="t-num">{row.count}</td>
                  <td className="t-num">{ratio(row.count, overview.total || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelShell>
    </>
  );
}
