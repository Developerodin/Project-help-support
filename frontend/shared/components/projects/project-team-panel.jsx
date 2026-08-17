'use client';

import { useMemo, useState } from 'react';
import { replaceProjectTeamMembers } from '@/shared/api/projects.js';
import { showToast } from '@/shared/lib/toast.js';

const ROLE_OPTIONS = [
  { value: 'team_lead', label: 'Team Lead' },
  { value: 'developer', label: 'Developer' },
  { value: 'qa', label: 'QA' },
  { value: 'member', label: 'Member' },
];

export default function ProjectTeamPanel({ project, teams, onUpdated }) {
  const [roleDraft, setRoleDraft] = useState({});
  const [savingRoles, setSavingRoles] = useState(false);

  const members = project.teamMembers || [];
  const dirtyRoles = useMemo(() => {
    const draft = {};
    for (const member of members) {
      draft[member.user.id] = roleDraft[member.user.id] ?? member.role;
    }
    return draft;
  }, [members, roleDraft]);

  const rolesChanged = members.some((member) => dirtyRoles[member.user.id] !== member.role);

  async function changeTeam(teamId) {
    await onUpdated(project.id, { team: teamId || null });
  }

  async function saveRoles() {
    if (!members.length) return;
    setSavingRoles(true);
    try {
      await replaceProjectTeamMembers(project.id, members.map((member) => ({
        userId: member.user.id,
        role: dirtyRoles[member.user.id],
      })));
      setRoleDraft({});
      showToast('Project team roles saved');
      await onUpdated(project.id, {});
    } catch (err) {
      showToast(err?.message || 'Could not save team roles');
    } finally {
      setSavingRoles(false);
    }
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
                  <select
                    aria-label={`Role for ${member.user.name}`}
                    value={dirtyRoles[member.user.id]}
                    onChange={(e) => setRoleDraft((prev) => ({
                      ...prev,
                      [member.user.id]: e.target.value,
                    }))}
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <span className="chip">Active</span>
                </li>
              ))}
            </ul>
          )}

          <div className="project-team-panel__foot">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!rolesChanged || savingRoles || !members.length}
              onClick={saveRoles}
            >
              {savingRoles ? 'Saving…' : 'Save team roles'}
            </button>
          </div>
        </>
      ) : (
        <p className="project-team-panel__empty">Assign a team to define who can work on this project.</p>
      )}
    </div>
  );
}
