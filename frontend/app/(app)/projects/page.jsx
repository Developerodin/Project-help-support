'use client';

import { useCallback, useEffect, useState } from 'react';
import { listProjects, patchProject, replaceModules } from '@/shared/api/projects.js';
import { listUsers } from '@/shared/api/users.js';
import { listTeams } from '@/shared/api/teams.js';
import FormError from '@/shared/components/form-error.jsx';
import ProjectModulesEditor from '@/shared/components/project-modules-editor.jsx';
import { formRowsToModules, modulesToFormRows } from '@/shared/lib/project-modules.js';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [teams, setTeams] = useState([]);
  const [modulesDraft, setModulesDraft] = useState({});
  const [error, setError] = useState(null);

  const syncModulesDraft = useCallback((nextProjects) => {
    setModulesDraft((prev) => {
      const next = { ...prev };
      for (const project of nextProjects) {
        if (!next[project.id]) {
          next[project.id] = modulesToFormRows(project.modules);
        }
      }
      return next;
    });
  }, []);

  const reload = useCallback(() => {
    listProjects()
      .then((p) => {
        setProjects(p.results);
        syncModulesDraft(p.results);
      })
      .catch(setError);
  }, [syncModulesDraft]);

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
      const rows = modulesDraft[project.id] ?? modulesToFormRows(project.modules);
      await replaceModules(project.id, formRowsToModules(rows));
      setModulesDraft((prev) => {
        const next = { ...prev };
        delete next[project.id];
        return next;
      });
      reload();
    } catch (err) {
      setError(err);
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
            <label>Modules</label>
            <p className="help">Group pages under module names for ticket location fields.</p>
            <ProjectModulesEditor
              projectKey={project.key}
              value={modulesDraft[project.id] ?? modulesToFormRows(project.modules)}
              onChange={(rows) => setModulesDraft((prev) => ({ ...prev, [project.id]: rows }))}
            />
          </div>
          <button type="button" className="btn btn-sm" onClick={() => saveModules(project)}>Save modules</button>
        </section>
      ))}
    </>
  );
}
