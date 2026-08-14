import { describe, expect, it } from 'vitest';
import {
  formRowsToModules,
  isModulesDraftEmpty,
  modulesToFormRows,
} from '../project-modules.js';

describe('project-modules helpers', () => {
  it('round-trips API modules through form rows', () => {
    const api = [
      { label: 'ATS', pages: [{ label: 'Jobs', path: '/ats/jobs' }] },
      { label: 'Settings', pages: [{ label: 'Users', path: '/settings/users' }] },
    ];
    expect(formRowsToModules(modulesToFormRows(api))).toEqual(api);
  });

  it('drops blank module and page rows', () => {
    const rows = modulesToFormRows([
      { label: 'ATS', pages: [{ label: 'Jobs', path: '/jobs' }, { label: '  ', path: '' }] },
      { label: '  ', pages: [{ label: 'Orphan', path: '/x' }] },
    ]);
    rows.push({ id: 'empty', label: '', pages: [] });
    expect(formRowsToModules(rows)).toEqual([
      { label: 'ATS', pages: [{ label: 'Jobs', path: '/jobs' }] },
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
