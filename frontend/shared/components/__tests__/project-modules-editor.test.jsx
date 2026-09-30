import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectModulesEditor from '../project-modules-editor.jsx';
import { formRowsToModules, modulesToFormRows } from '@/shared/lib/project-modules.js';
import { WEB_MODULE_TAXONOMY } from '@pms/shared';

describe('ProjectModulesEditor', () => {
  it('renders existing modules and pages', () => {
    render(
      <ProjectModulesEditor
        value={modulesToFormRows([{ label: 'ATS', pages: [{ label: 'Jobs', path: '/ats/jobs' }] }])}
        onChange={() => {}}
      />,
    );

    expect(screen.getByDisplayValue('ATS')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Jobs')).toBeInTheDocument();
    expect(screen.getByDisplayValue('/ats/jobs')).toBeInTheDocument();
  });

  it('adds modules and pages', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ProjectModulesEditor value={[]} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /add module/i }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ label: '', pages: [] })]);

    const seeded = modulesToFormRows([{ label: 'MAIN', pages: [] }]);
    render(<ProjectModulesEditor value={seeded} onChange={onChange} projectKey="MOB" />);
    await user.click(screen.getByRole('button', { name: /add page/i }));
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        label: 'MAIN',
        pages: [expect.objectContaining({ label: '', path: '', screens: [] })],
      }),
    ]);
  });

  it('loads the WEB default catalog when empty', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ProjectModulesEditor value={[]} onChange={onChange} projectKey="WEB" />);

    await user.click(screen.getByRole('button', { name: /load default catalog/i }));
    const loaded = formRowsToModules(onChange.mock.calls.at(-1)[0]);
    expect(loaded.map((mod) => mod.label)).toEqual(WEB_MODULE_TAXONOMY.map((mod) => mod.label));
    expect(loaded.every((mod) => mod.key)).toBe(true);
  });

  it('opens the screens drawer for a page row', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const value = modulesToFormRows([
      {
        label: 'ATS',
        pages: [{
          label: 'Jobs',
          path: '/ats/jobs',
          screens: [{ name: 'Jobs List', type: 'list', route: '/ats/jobs', status: 'active' }],
        }],
      },
    ]);

    render(<ProjectModulesEditor value={value} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /screens/i }));
    expect(screen.getByRole('dialog', { name: /screens/i })).toBeInTheDocument();
    expect(screen.getByText('Jobs List')).toBeInTheDocument();
    expect(screen.getByText('ATS')).toBeInTheDocument();
    expect(screen.getAllByText('/ats/jobs').length).toBeGreaterThan(0);
  });
});
