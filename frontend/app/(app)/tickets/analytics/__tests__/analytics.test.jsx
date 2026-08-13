import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AnalyticsPage from '../page.jsx';

const getOverview = vi.fn();
const getTrend = vi.fn();
const getTimeInStage = vi.fn();
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
vi.mock('@/shared/api/analytics.js', () => ({
  getOverview: (...args) => getOverview(...args),
  getTrend: (...args) => getTrend(...args),
  getTimeInStage: (...args) => getTimeInStage(...args),
  getDrill: (...args) => getDrill(...args),
}));
vi.mock('react-apexcharts', () => ({
  default: () => <div data-testid="chart" />,
}));

const overview = {
  total: 42,
  lanes: { intake: 5, development: 12, qa: 8, release: 6, done: 11 },
  blockerCritical: 3,
  estimates: { measured: 10, early: 2, onTime: 5, late: 3 },
  reopens: { rate: 0.18, reopenedAfterQa: 8, reachedQa: 44 },
};

describe('AnalyticsPage lane stat tiles', () => {
  beforeEach(() => {
    getOverview.mockResolvedValue(overview);
    getTrend.mockResolvedValue({ points: [{ bucket: '2026-01', created: 1, closed: 0 }] });
    getTimeInStage.mockResolvedValue({
      bottleneck: 'ready_qa',
      byStage: Object.fromEntries(
        ['pending', 'under_review', 'in_progress', 'ready_local', 'ready_qa', 'deployed_staging', 'qa_approved', 'ready_production', 'live', 'closed']
          .map((key) => [key, { count: 1, medianHours: 2, p90Hours: 4 }]),
      ),
    });
    getDrill.mockResolvedValue({ rows: [{ key: 'P1', count: 3 }] });
  });

  it('renders lane labels and counts in stat tiles, not clipped measure bars', async () => {
    render(<AnalyticsPage />);

    await waitFor(() => expect(screen.getByText('Intake')).toBeInTheDocument());

    for (const label of ['Intake', 'Development', 'QA', 'Release', 'Done', 'Blocker / Critical']) {
      expect(screen.getByText(label)).toBeVisible();
    }

    expect(screen.getByText('5')).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();

    const tiles = document.querySelectorAll('.stat-tile');
    expect(tiles).toHaveLength(6);
    expect(document.querySelector('.measure')).toBeNull();
  });
});
