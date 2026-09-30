import { describe, expect, it } from 'vitest';
import {
  parseTeamsReturnUrl,
  teamsListUrlFromSearch,
  withTeamsReturn,
  TEAMS_RETURN_PARAM,
} from './teams-return-url.js';

describe('teams-return-url', () => {
  it('builds list URLs from search strings', () => {
    expect(teamsListUrlFromSearch('')).toBe('/teams');
    expect(teamsListUrlFromSearch('page=2&search=qa')).toBe('/teams?page=2&search=qa');
  });

  it('rejects unsafe return URLs', () => {
    expect(parseTeamsReturnUrl('https://evil.example')).toBe('/teams');
    expect(parseTeamsReturnUrl('/teams?page=1')).toBe('/teams?page=1');
  });

  it('appends return param to hrefs', () => {
    const href = withTeamsReturn('/teams/new', '/teams?page=2');
    expect(href).toContain(`${TEAMS_RETURN_PARAM}=`);
    expect(decodeURIComponent(href)).toContain('/teams?page=2');
  });
});
