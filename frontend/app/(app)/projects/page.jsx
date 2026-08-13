'use client';

import { useCallback, useEffect, useState } from 'react';
import { listProjects, patchProject, replaceModules } from '@/shared/api/projects.js';
import { listUsers } from '@/shared/api/users.js';
import { listTeams } from '@/shared/api/teams.js';
import FormError from '@/shared/components/form-error.jsx';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [modulesText, setModulesText] = useState({});
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    listProjects().then((p) => setProjects(p.results)).catch(setError);
  }, []);

  useEffect(() => {
    reload();
    listUsers({ status: 'active' }).then((p) => setUsers(p.results)).catch(() => {});
    listTeams().then((p) => setTeams(p.results)).catch(() => {});
  }, [reload]);

  const update = async (id, body) => {
    setError(null);
    try {
      await patchProject(id, body);
      reload();
    } catch (err) { setError(err); }
  };

  const saveModules = async (project) => {
    setError(null);
    try {
      await replaceModules(project.id, JSON.parse(modulesText[project.id] ?? '[]'));
      reload();
    } catch (err) {
      setError(err instanceof SyntaxError ? { message: 'Modules must be valid JSON' } : err);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="sub">Module taxonomy, default assignees and testers for each product line.</p>
        </div>
      </div>
      <FormError error={error} />

      {projects.map((project) => (
        <section key={project.id} className="panel" style={{ marginBottom: 12 }}>
          <header>
            <h3><span className="mono">{project.key}</span> — {project.name}</h3>
            <span className="spacer" />
            <span className="chip">{project.status}</span>
          </header>

          <div className="formgrid">
            <div className="form-row">
              <label htmlFor={`assignee-${project.id}`}>Default assignee</label>
              <select id={`assignee-${project.id}`} value={project.defaultAssignee?.id || ''}
                onChange={(e) => update(project.id, { defaultAssignee: e.target.value || null })}>
                <option value="">—</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            <div className="form-row">
              <label htmlFor={`tester-${project.id}`}>Default tester</label>
              <select id={`tester-${project.id}`} value={project.defaultTester?.id || ''}
                onChange={(e) => update(project.id, { defaultTester: e.target.value || null })}>
                <option value="">—</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>

            <div className="form-row">
              <label htmlFor={`team-${project.id}`}>Default team</label>
              <select id={`team-${project.id}`} value={project.defaultTeam?.id || ''}
                onChange={(e) => update(project.id, { defaultTeam: e.target.value || null })}>
                <option value="">—</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <label htmlFor={`modules-${project.id}`}>Modules (JSON)</label>
            <textarea
              id={`modules-${project.id}`} rows={6}
              value={modulesText[project.id] ?? JSON.stringify(project.modules, null, 2)}
              onChange={(e) => setModulesText({ ...modulesText, [project.id]: e.target.value })}
            />
          </div>
          <button type="button" className="btn btn-sm" onClick={() => saveModules(project)}>Save modules</button>
        </section>
      ))}
    </>
  );
}
