'use client';

import { useMemo } from 'react';
import { getUserRoles } from '@pms/shared';
import { capRole } from '@/shared/lib/profile-utils.js';
import { filterTeamsForProjectAssignment } from '@/shared/lib/team-scope.js';

function entityId(ref) {
  if (!ref) return '';
  if (typeof ref === 'string') return ref;
  return String(ref.id || ref._id || '');
}

function membersFromProject(project) {
  return project.teamMembers || [];
}

function membersFromTeam(team) {
  return (team?.members || []).map((user) => ({
    user: {
      id: user.id || user._id,
      name: user.name,
      email: user.email,
      globalRole: user.globalRole || getUserRoles(user)[0] || user.role,
    },
  }));
}

export default function ProjectTeamPanel({
  project,
  teams,
  teamId,
  onTeamChange,
  disabled = false,
}) {
  const currentTeamId = teamId !== undefined
    ? (teamId || '')
    : entityId(project.team);
  const selectableTeams = useMemo(
    () => filterTeamsForProjectAssignment(teams, project.id, project.team),
    [teams, project.id, project.team],
  );
  const selectedTeam = selectableTeams.find((team) => entityId(team) === currentTeamId);
  const members = currentTeamId && currentTeamId === entityId(project.team)
    ? membersFromProject(project)
    : membersFromTeam(selectedTeam);
  const selectId = `project-team-${project.id}`;

  function changeTeam(nextId) {
    if (onTeamChange) {
      onTeamChange(nextId);
    }
  }

  return (
    <div className="project-team-panel">
      <div className="form-row">
        <label htmlFor={selectId}>Project team</label>
        <select
          id={selectId}
          value={currentTeamId}
          onChange={(e) => changeTeam(e.target.value)}
          disabled={disabled}
        >
          <option value="">No team assigned</option>
          {selectableTeams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
      </div>

      {currentTeamId ? (
        <>
          <div className="project-team-panel__head">
            <span className="lbl">Team members</span>
            <span className="meta">{members.length}</span>
          </div>

          {members.length === 0 ? (
            <p className="project-team-panel__empty">This team has no members yet.</p>
          ) : (
            <ul className="project-team-panel__list">
              {members.map((member) => (
                <li key={member.user.id} className="project-team-panel__row">
                  <div className="project-team-panel__who">
                    <b>{member.user.name}</b>
                    <span>{member.user.email}</span>
                  </div>
                  <span className="chip member-row__role">
                    {capRole(member.user.globalRole)}
                  </span>
                  <span className="chip">Active</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="project-team-panel__empty">Assign a team to define who can work on this project.</p>
      )}
    </div>
  );
}
