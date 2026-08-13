'use client';

import { useCallback, useEffect, useState } from 'react';
import { listTeams, createTeam, updateMembers } from '@/shared/api/teams.js';
import { listProjects } from '@/shared/api/projects.js';
import { listUsers } from '@/shared/api/users.js';
import FormError from '@/shared/components/form-error.jsx';

export default function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [draft, setDraft] = useState({ name: '', project: '' });
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    listTeams().then((p) => setTeams(p.results)).catch(setError);
  }, []);

  useEffect(() => {
    reload();
    listProjects().then((p) => setProjects(p.results)).catch(() => {});
    listUsers({ status: 'active' }).then((p) => setUsers(p.results)).catch(() => {});
  }, [reload]);

  async function create(event) {
    event.preventDefault();
    setError(null);
    try {
      await createTeam({ name: draft.name, project: draft.project || null });
      setDraft({ name: '', project: '' });
      reload();
    } catch (err) { setError(err); }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Teams</h1>
          <p className="sub">Route work to a group. A ticket may have a team, a person, or both.</p>
        </div>
      </div>
      <FormError error={error} />

      <form className="toolbar" onSubmit={create}>
        <label className="lbl" htmlFor="team-name">Team name</label>
        <input id="team-name" required placeholder="Team name" value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <label className="lbl" htmlFor="team-project">Project scope</label>
        <select id="team-project" value={draft.project}
          onChange={(e) => setDraft({ ...draft, project: e.target.value })}>
          <option value="">Global (all projects)</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="submit" className="btn btn-primary">Create team</button>
      </form>

      {teams.length === 0 ? (
        <div className="empty">
          <h3>No teams yet</h3>
          <p>Create a team to route tickets to a group. Teams can be global or scoped to one project.</p>
        </div>
      ) : (
      <div className="teamgrid">
        {teams.map((team) => (
          <section key={team.id} className="panel">
            <header>
              <h3>{team.name}</h3>
              <span className="spacer" />
              <span className="chip">{team.project ? team.project.key : 'global'}</span>
            </header>
            <p className="meta">{team.members.map((m) => m.name).join(', ') || 'No members'}</p>
            <label className="lbl" htmlFor={`add-${team.id}`}>Add member</label>
            <select
              id={`add-${team.id}`} defaultValue=""
              onChange={async (e) => {
                if (!e.target.value) return;
                await updateMembers(team.id, { add: [e.target.value] });
                reload();
              }}
            >
              <option value="">—</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </section>
        ))}
      </div>
      )}
    </>
  );
}
