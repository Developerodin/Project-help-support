import { describe, it, expect } from 'vitest';
import { isTeamUsableOnProject, filterTeamsForProjectAssignment } from '../team-scope.js';

const PROJECT_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const PROJECT_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const globalTeam = { id: 'g1', name: 'Global Team', project: null };
const projectTeamA = { id: 'ta', name: 'Project Team A', project: { id: PROJECT_A } };
const projectTeamB = { id: 'tb', name: 'Project Team B', project: { id: PROJECT_B } };
const allTeams = [globalTeam, projectTeamA, projectTeamB];

describe('isTeamUsableOnProject', () => {
  it('allows global teams on every project', () => {
    expect(isTeamUsableOnProject(globalTeam, PROJECT_A)).toBe(true);
    expect(isTeamUsableOnProject(globalTeam, PROJECT_B)).toBe(true);
  });

  it('allows project teams only on their assigned project', () => {
    expect(isTeamUsableOnProject(projectTeamA, PROJECT_A)).toBe(true);
    expect(isTeamUsableOnProject(projectTeamA, PROJECT_B)).toBe(false);
    expect(isTeamUsableOnProject(projectTeamB, PROJECT_B)).toBe(true);
    expect(isTeamUsableOnProject(projectTeamB, PROJECT_A)).toBe(false);
  });
});

describe('filterTeamsForProjectAssignment', () => {
  it('shows global and matching project teams on project A', () => {
    const result = filterTeamsForProjectAssignment(allTeams, PROJECT_A);
    expect(result.map((team) => team.id)).toEqual(['g1', 'ta']);
  });

  it('shows global and matching project teams on project B', () => {
    const result = filterTeamsForProjectAssignment(allTeams, PROJECT_B);
    expect(result.map((team) => team.id)).toEqual(['g1', 'tb']);
  });

  it('keeps an out-of-scope current assignment in the dropdown', () => {
    const assigned = { id: 'tb', name: 'Project Team B' };
    const result = filterTeamsForProjectAssignment(allTeams, PROJECT_A, assigned);
    expect(result.map((team) => team.id)).toEqual(['g1', 'ta', 'tb']);
  });
});
