import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import UiQaDetailDrawer from '../ui-qa-detail-drawer.jsx';

const getUiQaEntity = vi.fn();
const logApiError = vi.fn();

vi.mock('@/shared/api/ui-qa.js', () => ({
  getUiQaEntity: (...args) => getUiQaEntity(...args),
}));
vi.mock('@/shared/lib/api-error.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    logApiError: (...args) => logApiError(...args),
  };
});
vi.mock('../ui-qa-entity-workspace.jsx', () => ({
  default: ({ title }) => <div data-testid="ui-qa-workspace">{title}</div>,
}));

const selection = {
  entity: { level: 'module', moduleKey: 'mod-ats' },
  title: 'ATS',
};

const entityDetail = {
  entity: selection.entity,
  title: 'ATS',
  breadcrumbs: [],
  data: { key: 'mod-ats', label: 'ATS', qaStatus: 'open' },
  counts: { pages: 1, screens: 2 },
};

describe('UiQaDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUiQaEntity.mockResolvedValue(entityDetail);
  });

  it('shows a loader on first render instead of a false load error', async () => {
    render(
      <UiQaDetailDrawer
        projectId="project-1"
        selection={selection}
        user={{ _id: 'u1' }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(logApiError).not.toHaveBeenCalled();
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('ui-qa-workspace')).toHaveTextContent('ATS');
    });
    expect(getUiQaEntity).toHaveBeenCalledWith('project-1', selection.entity);
  });

  it('shows an API error when entity details fail to load', async () => {
    getUiQaEntity.mockRejectedValue({
      status: 404,
      code: 'UI_QA_ENTITY_NOT_FOUND',
      message: 'Module not found',
    });

    render(
      <UiQaDetailDrawer
        projectId="project-1"
        selection={selection}
        user={{ _id: 'u1' }}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Module not found');
    });
    expect(logApiError).toHaveBeenCalled();
  });
});
