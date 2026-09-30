import { describe, it, expect } from 'vitest';
import {
  parseProjectsReturnUrl,
  projectsListUrlFromSearch,
  withProjectsReturn,
} from '../projects-return-url.js';

describe('projects-return-url', () => {
  it('builds list URL from search string', () => {
    expect(projectsListUrlFromSearch('')).toBe('/projects');
    expect(projectsListUrlFromSearch('?page=2&search=foo')).toBe('/projects?page=2&search=foo');
    expect(projectsListUrlFromSearch('page=2')).toBe('/projects?page=2');
  });

  it('parses safe return URLs', () => {
    expect(parseProjectsReturnUrl('/projects?page=2&search=foo')).toBe('/projects?page=2&search=foo');
    expect(parseProjectsReturnUrl(encodeURIComponent('/projects?page=2'))).toBe('/projects?page=2');
    expect(parseProjectsReturnUrl('https://evil.test/projects')).toBe('/projects');
    expect(parseProjectsReturnUrl('/tickets')).toBe('/projects');
    expect(parseProjectsReturnUrl(null)).toBe('/projects');
  });

  it('appends return query to href', () => {
    expect(withProjectsReturn('/projects/new?clientId=c1', '/projects?page=2'))
      .toBe('/projects/new?clientId=c1&return=%2Fprojects%3Fpage%3D2');
  });
});
