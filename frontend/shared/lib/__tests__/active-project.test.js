import { describe, expect, it, beforeEach } from 'vitest';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  readStoredProjectId,
  resolveInitialProjectId,
  writeStoredProjectId,
} from '../active-project.js';

describe('active-project storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to WEB when nothing is stored', () => {
    const projects = [
      { id: 'mob-id', key: 'MOB' },
      { id: 'web-id', key: 'WEB' },
    ];
    expect(resolveInitialProjectId(projects)).toBe('web-id');
  });

  it('restores a valid stored project id', () => {
    writeStoredProjectId('mob-id');
    const projects = [
      { id: 'mob-id', key: 'MOB' },
      { id: 'web-id', key: 'WEB' },
    ];
    expect(resolveInitialProjectId(projects)).toBe('mob-id');
  });

  it('treats all-projects as null', () => {
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, 'all');
    expect(readStoredProjectId()).toBeNull();
  });

  it('keeps all-projects after reload instead of defaulting to WEB', () => {
    window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, 'all');
    const projects = [
      { id: 'mob-id', key: 'MOB' },
      { id: 'web-id', key: 'WEB' },
    ];
    expect(resolveInitialProjectId(projects)).toBeNull();
  });
});
