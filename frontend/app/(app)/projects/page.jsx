'use client';

import { useCallback, useEffect, useState } from 'react';
import { listProjects, patchProject, replaceModules } from '@/shared/api/projects.js';
import { listUsers } from '@/shared/api/users.js';
import { listTeams } from '@/shared/api/teams.js';
import FormError from '@/shared/components/form-error.jsx';
import ProjectModulesEditor from '@/shared/components/project-modules-editor.jsx';
import { formRowsToModules, modulesToFormRows } from '@/shared/lib/project-modules.js';
import { showToast } from '@/shared/lib/toast.js';

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
      showToast(`Module catalog saved for ${project.key}`);
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

      {projects.map((project) => {
        const moduleRows = modulesDraft[project.id] ?? modulesToFormRows(project.modules);
        const hasModuleDraft = Boolean(modulesDraft[project.id]);

        return (
          <section key={project.id} className="panel project-panel">
            <header>
              <h3><span className="mono">{project.key}</span> — {project.name}</h3>
              <span className="spacer" />
              <span className="chip">{project.status}</span>
            </header>

            <div className="project-form">
              <div className="project-form-section">
                <div className="project-form-intro">
                  <h4 className="project-form-heading">Defaults</h4>
                  <p className="project-form-hint">
                    Pre-fill assignee, tester, and team when someone files a ticket in this project.
                  </p>
                </div>

                <div className="project-defaults-grid">
                  <div className="form-row">
                    <label htmlFor={`assignee-${project.id}`}>Default assignee</label>
                    <select
                      id={`assignee-${project.id}`}
                      value={project.defaultAssignee?.id || ''}
                      onChange={(e) => update(project.id, { defaultAssignee: e.target.value || null })}
                    >
                      <option value="">—</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>

                  <div className="form-row">
                    <label htmlFor={`tester-${project.id}`}>Default tester</label>
                    <select
                      id={`tester-${project.id}`}
                      value={project.defaultTester?.id || ''}
                      onChange={(e) => update(project.id, { defaultTester: e.target.value || null })}
                    >
                      <option value="">—</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>

                  <div className="form-row">
                    <label htmlFor={`team-${project.id}`}>Default team</label>
                    <select
                      id={`team-${project.id}`}
                      value={project.defaultTeam?.id || ''}
                      onChange={(e) => update(project.id, { defaultTeam: e.target.value || null })}
                    >
                      <option value="">—</option>
                      {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="project-form-section project-form-section--catalog">
                <div className="project-form-intro">
                  <h4 className="project-form-heading">Module catalog</h4>
                  <p className="project-form-hint">
                    Group pages under module names for ticket location fields on new tickets.
                  </p>
                </div>

                <ProjectModulesEditor
                  projectKey={project.key}
                  value={moduleRows}
                  onChange={(rows) => setModulesDraft((prev) => ({ ...prev, [project.id]: rows }))}
                  onSave={() => saveModules(project)}
                  hasUnsavedChanges={hasModuleDraft}
                />
              </div>
            </div>
          </section>
        );
      })}
    </>
  );
}
