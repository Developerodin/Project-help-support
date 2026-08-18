'use client';

import { capRole } from '@/shared/lib/profile-utils.js';

export default function ProjectTeamPanel({ project, teams, onUpdated }) {
  const members = project.teamMembers || [];

  async function changeTeam(teamId) {
    await onUpdated(project.id, { team: teamId || null });
  }

  return (
    <div className="project-team-panel">
      <div className="form-row">
        <label htmlFor={`project-team-${project.id}`}>Project team</label>
        <select
          id={`project-team-${project.id}`}
          value={project.team?.id || ''}
          onChange={(e) => changeTeam(e.target.value)}
        >
          <option value="">No team assigned</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
      </div>

      {project.team ? (
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
