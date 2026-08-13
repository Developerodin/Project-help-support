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
      <h1>Teams</h1>
      <FormError error={error} />

      <form onSubmit={create} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <label htmlFor="team-name">Name</label>
        <input id="team-name" required value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />

        <label htmlFor="team-project">Project</label>
        <select id="team-project" value={draft.project}
          onChange={(e) => setDraft({ ...draft, project: e.target.value })}>
          {/* An empty value means GLOBAL — usable on every project. */}
          <option value="">Global (all projects)</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <button type="submit">Create team</button>
      </form>

      {teams.map((team) => (
        <section key={team.id}
          style={{ border: '1px solid var(--border)', padding: 12, marginBottom: 8 }}>
          <h2>{team.name} {team.project ? `(${team.project.key})` : '(global)'}</h2>
          <p>{team.members.map((m) => m.name).join(', ') || 'No members'}</p>

          <label htmlFor={`add-${team.id}`}>Add member</label>
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
    </>
  );
}
