import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProjectTeamPanel from '../project-team-panel.jsx';

const PROJECT_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const PROJECT_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const globalTeam = { id: 'g1', name: 'Global Team', project: null };
const projectTeamA = { id: 'ta', name: 'Project Team A', project: { id: PROJECT_A } };
const projectTeamB = { id: 'tb', name: 'Project Team B', project: { id: PROJECT_B } };
const allTeams = [globalTeam, projectTeamA, projectTeamB];

function renderPanel(projectOverrides = {}, teams = allTeams) {
  const project = {
    id: PROJECT_A,
    team: null,
    teamMembers: [],
    ...projectOverrides,
  };

  return render(
    <ProjectTeamPanel
      project={project}
      teams={teams}
      onUpdated={vi.fn()}
    />,
  );
}

function optionLabels() {
  return screen.getAllByRole('option').map((option) => option.textContent);
}

describe('ProjectTeamPanel', () => {
  it('shows global and project A teams on project A', () => {
    renderPanel();
    expect(optionLabels()).toEqual(['No team assigned', 'Global Team', 'Project Team A']);
  });

  it('does not show project B teams on project A', () => {
    renderPanel({ id: PROJECT_A });
    expect(optionLabels()).not.toContain('Project Team B');
  });

  it('keeps an out-of-scope assigned team visible', () => {
    renderPanel({ team: projectTeamB });
    expect(optionLabels()).toEqual([
      'No team assigned',
      'Global Team',
      'Project Team A',
      'Project Team B',
    ]);
    expect(screen.getByRole('combobox')).toHaveValue('tb');
  });
});
