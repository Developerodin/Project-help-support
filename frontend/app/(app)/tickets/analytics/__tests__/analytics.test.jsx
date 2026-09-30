import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AnalyticsPage from '../page.jsx';

const getDashboard = vi.fn();
const getTrend = vi.fn();
const getDelivery = vi.fn();
const getDrill = vi.fn();

vi.mock('@/shared/contexts/theme-context.jsx', () => ({
  useTheme: () => ({ theme: 'light', isLight: true, setTheme: vi.fn(), toggleTheme: vi.fn() }),
}));
vi.mock('@/shared/contexts/project-context.jsx', () => ({
  useProject: () => ({
    activeProjectId: null,
    activeProject: null,
    projects: [],
    loading: false,
    setActiveProjectId: vi.fn(),
  }),
}));
vi.mock('@/shared/lib/use-history-search.js', () => ({
  useHistorySearch: () => '',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock('@/shared/api/analytics.js', () => ({
  getDashboard: (...args) => getDashboard(...args),
  getTrend: (...args) => getTrend(...args),
  getDelivery: (...args) => getDelivery(...args),
  getDrill: (...args) => getDrill(...args),
}));
vi.mock('react-apexcharts', () => ({
  default: () => <div data-testid="chart" />,
}));

const overviewPayload = {
  total: 42,
  lanes: { intake: 5, development: 12, qa: 8, release: 6, done: 11 },
  byStage: { pending: 5 },
  blockerCritical: 3,
  estimates: { measured: 10, early: 2, onTime: 5, late: 3 },
  reopens: { rate: 0.18, reopenedAfterQa: 8, reachedQa: 44 },
  aging: { '0-1': 1, '2-7': 2, '8-30': 3, '31+': 4 },
};

const stageMap = Object.fromEntries(
  ['pending', 'under_review', 'in_progress', 'ready_local', 'ready_qa', 'deployed_staging', 'qa_approved', 'ready_production', 'live', 'closed']
    .map((key) => [key, { count: 1, medianHours: 2, p90Hours: 4 }]),
);

describe('AnalyticsPage lane stat tiles', () => {
  beforeEach(() => {
    getDashboard.mockResolvedValue({
      ticketCount: 42,
      exceedsCeiling: false,
      ceiling: 10000,
      overview: overviewPayload,
      trend: { groupBy: 'day', points: [{ bucket: '2026-01', created: 1, closed: 0 }] },
      delivery: {
        groupBy: 'day',
        windowDays: 30,
        summary: { openTickets: 10, blockedOpen: 1, atRiskOpen: 2, blockedRate: 0.1, atRiskRate: 0.2 },
        leadTime: { samples: 3, medianHours: 1, p90Hours: 2, averageHours: 1.5 },
        cycleTime: { samples: 2, medianHours: 2, p90Hours: 3, averageHours: 2.5 },
        throughput: [{ bucket: '2026-01', live: 1, closed: 0 }],
      },
      timeInStage: { bottleneck: 'ready_qa', byStage: stageMap },
      drill: { dimension: 'severity', rows: [{ key: 'P1', count: 3 }] },
      categoryDrill: { rows: [{ key: 'Bug', count: 2 }] },
      severityDrill: { rows: [{ key: 'Major', count: 3 }] },
    });
    getTrend.mockResolvedValue({ groupBy: 'day', points: [{ bucket: '2026-01', created: 1, closed: 0 }] });
    getDelivery.mockResolvedValue({
      groupBy: 'day',
      summary: { openTickets: 10, blockedOpen: 1, atRiskOpen: 2, blockedRate: 0.1, atRiskRate: 0.2 },
      leadTime: { samples: 3, medianHours: 1, p90Hours: 2, averageHours: 1.5 },
      cycleTime: { samples: 2, medianHours: 2, p90Hours: 3, averageHours: 2.5 },
      throughput: [{ bucket: '2026-01', live: 1, closed: 0 }],
    });
    getDrill.mockResolvedValue({ rows: [{ key: 'P1', count: 3 }] });
  });

  it('renders lane labels and counts in stat tiles, not clipped measure bars', async () => {
    render(<AnalyticsPage />);

    await waitFor(() => expect(screen.getByText('Intake')).toBeInTheDocument());

    for (const label of ['Intake', 'Development', 'QA', 'Release', 'Done', 'Blocker / Critical']) {
      expect(screen.getByText(label)).toBeVisible();
    }

    const alertTile = document.querySelector('.stat-tile--alert .bigfig');
    expect(alertTile?.textContent).toBe('3');

    const tiles = document.querySelectorAll('.stat-grid .stat-tile');
    expect(tiles.length).toBeGreaterThanOrEqual(6);
  });

  it('shows bundle retry after initial dashboard failure', async () => {
    getDashboard.mockRejectedValueOnce(new Error('Dashboard unavailable'));
    render(<AnalyticsPage />);

    await waitFor(() => expect(screen.getByText('Retry')).toBeInTheDocument());
    getDashboard.mockResolvedValue({
      ticketCount: 42,
      exceedsCeiling: false,
      ceiling: 10000,
      overview: overviewPayload,
      trend: { groupBy: 'day', points: [] },
      delivery: {
        groupBy: 'day',
        windowDays: 30,
        summary: { openTickets: 0, blockedOpen: 0, atRiskOpen: 0, blockedRate: null, atRiskRate: null },
        leadTime: { samples: 0, medianHours: null, p90Hours: null, averageHours: null },
        cycleTime: { samples: 0, medianHours: null, p90Hours: null, averageHours: null },
        throughput: [],
      },
      timeInStage: { bottleneck: null, byStage: stageMap },
      drill: { rows: [] },
      categoryDrill: { rows: [] },
      severityDrill: { rows: [] },
    });
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Analytics')).toBeInTheDocument());
  });
});
