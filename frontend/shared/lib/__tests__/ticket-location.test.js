import { describe, expect, it } from 'vitest';
import {
  defaultModulePageSelection,
  defaultPageForModule,
  pagesForModule,
} from '../ticket-location.js';

describe('ticket-location helpers', () => {
  it('de-duplicates pages by label for a selected module', () => {
    const modules = [
      {
        label: 'MAIN',
        pages: [
          { label: 'Dashboard', path: '/dashboard' },
          { label: 'Dashboard', path: '/dashboard' },
          { label: 'Reports', path: '/reports' },
        ],
      },
    ];

    expect(pagesForModule(modules, 'MAIN')).toEqual([
      { label: 'Dashboard', path: '/dashboard' },
      { label: 'Reports', path: '/reports' },
    ]);
  });

  it('uses the de-duplicated first page as default', () => {
    const modules = [
      {
        label: 'MAIN',
        pages: [
          { label: 'Dashboard', path: '/dashboard' },
          { label: 'Dashboard', path: '/dashboard' },
        ],
      },
    ];

    expect(defaultPageForModule(modules, 'MAIN')).toBe('Dashboard');
    expect(defaultModulePageSelection(modules)).toEqual({
      module: 'MAIN',
      page: 'Dashboard',
    });
  });
});
