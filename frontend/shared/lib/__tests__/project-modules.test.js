import { describe, expect, it } from 'vitest';
import {
  formRowsToModules,
  isModulesDraftEmpty,
  modulesToFormRows,
} from '../project-modules.js';

describe('project-modules helpers', () => {
  it('round-trips API modules through form rows', () => {
    const api = [
      {
        label: 'ATS',
        pages: [{
          label: 'Jobs',
          path: '/ats/jobs',
          screens: [
            { name: 'Jobs List', type: 'list', route: '/ats/jobs', status: 'active', documentation: '' },
            { name: 'Create Job', type: 'create', route: '/ats/jobs/new', status: 'active', documentation: '' },
          ],
        }],
      },
      { label: 'Settings', pages: [{ label: 'Users', path: '/settings/users' }] },
    ];
    const back = formRowsToModules(modulesToFormRows(api));
    expect(back[0].label).toBe('ATS');
    expect(back[0].key).toBeTruthy();
    expect(back[0].pages[0].label).toBe('Jobs');
    expect(back[0].pages[0].screens).toHaveLength(2);
    expect(back[1].label).toBe('Settings');
  });

  it('drops blank module and page rows', () => {
    const rows = modulesToFormRows([
      { label: 'ATS', pages: [{ label: 'Jobs', path: '/jobs' }, { label: '  ', path: '' }] },
      { label: '  ', pages: [{ label: 'Orphan', path: '/x' }] },
    ]);
    rows.push({ id: 'empty', label: '', pages: [] });
    expect(formRowsToModules(rows)).toEqual([
      { key: expect.any(String), label: 'ATS', pages: [{ key: expect.any(String), label: 'Jobs', path: '/jobs' }] },
    ]);
  });

  it('detects empty drafts', () => {
    expect(isModulesDraftEmpty([])).toBe(true);
    expect(isModulesDraftEmpty(modulesToFormRows([]))).toBe(true);
    expect(isModulesDraftEmpty(modulesToFormRows([
      { label: 'ATS', pages: [{ label: 'Jobs', path: '/jobs' }] },
    ]))).toBe(false);
  });
});
