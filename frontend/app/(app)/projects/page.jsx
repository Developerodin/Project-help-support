'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { listProjects, patchProject, replaceModules } from '@/shared/api/projects.js';
import { listTeams } from '@/shared/api/teams.js';
import FormError from '@/shared/components/form-error.jsx';
import Icon from '@/shared/components/icons.jsx';
import ProjectTeamPanel from '@/shared/components/projects/project-team-panel.jsx';
import ProjectModulesEditor from '@/shared/components/project-modules-editor.jsx';
import { groupProjectsByBrand } from '@/shared/lib/group-projects-by-brand.js';
import { formRowsToModules, modulesToFormRows } from '@/shared/lib/project-modules.js';
import { showToast } from '@/shared/lib/toast.js';

const EXPANDED_STORAGE_KEY = 'pms-projects-expanded';
const BRAND_EXPANDED_STORAGE_KEY = 'pms-brands-expanded';

function mergeExpandedState(prev, projectIds) {
  const next = { ...prev };
  for (const id of projectIds) {
    if (!(id in next)) next[id] = true;
  }
  return next;
}

function mergeBrandExpandedState(prev, brands) {
  const next = { ...prev };
  for (const brand of brands) {
    if (!(brand in next)) next[brand] = true;
  }
  return next;
}

function readStoredExpanded(key) {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistExpandedState(key, next) {
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage may be unavailable in private mode.
  }
}

function ProjectPanel({
  project,
  teams,
  moduleRows,
  hasModuleDraft,
  isExpanded,
  onToggleExpanded,
  onUpdate,
  onSaveModules,
  onModulesChange,
}) {
  return (
    <section
      className={`panel project-panel${isExpanded ? '' : ' collapsed'}`}
    >
      <header className="project-panel-head">
        <h4 className="project-panel-title">
          <button
            type="button"
            className="project-panel-head-toggle"
            aria-expanded={isExpanded}
            aria-controls={`project-body-${project.id}`}
            onClick={() => onToggleExpanded(project.id)}
          >
            <span className="project-panel-chev" aria-hidden="true">
              <Icon name="chev-right" size={14} />
            </span>
            <span className="project-panel-head-label">
              <span className="mono">{project.key}</span> — {project.name}
            </span>
            <span className="spacer" />
            <span className="chip">{project.status}</span>
            <span className="sr">{isExpanded ? 'Collapse' : 'Expand'} {project.name}</span>
          </button>
        </h4>
      </header>

      <div className="project-form" id={`project-body-${project.id}`}>
        <div className="project-form-section">
          <div className="project-form-intro">
            <h5 className="project-form-heading">Project team</h5>
            <p className="project-form-hint">
              Assign one team to this project and set each member&apos;s project role.
            </p>
          </div>

          <ProjectTeamPanel project={project} teams={teams} onUpdated={onUpdate} />
        </div>

        <div className="project-form-section project-form-section--catalog">
          <div className="project-form-intro">
            <h5 className="project-form-heading">Module catalog</h5>
            <p className="project-form-hint">
              Group pages under module names for ticket location fields on new tickets.
            </p>
          </div>

          <ProjectModulesEditor
            projectKey={project.key}
            value={moduleRows}
            onChange={(rows) => onModulesChange(project.id, rows)}
            onSave={() => onSaveModules(project)}
            hasUnsavedChanges={hasModuleDraft}
          />
        </div>
      </div>
    </section>
  );
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [modulesDraft, setModulesDraft] = useState({});
  const [expanded, setExpanded] = useState({});
  const [brandExpanded, setBrandExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const brandGroups = useMemo(() => groupProjectsByBrand(projects), [projects]);

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
    setLoading(true);
    return listProjects()
      .then((p) => {
        setProjects(p.results);
        syncModulesDraft(p.results);
        const groups = groupProjectsByBrand(p.results);
        setExpanded((prev) => mergeExpandedState({ ...readStoredExpanded(EXPANDED_STORAGE_KEY), ...prev }, p.results.map((x) => x.id)));
        setBrandExpanded((prev) => mergeBrandExpandedState({ ...readStoredExpanded(BRAND_EXPANDED_STORAGE_KEY), ...prev }, groups.map((g) => g.brand)));
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [syncModulesDraft]);

  useEffect(() => {
    reload();
    listTeams().then((p) => setTeams(p.results)).catch(() => {});
  }, [reload]);

  const toggleExpanded = (projectId) => {
    setExpanded((prev) => {
      const currentlyExpanded = prev[projectId] !== false;
      const next = { ...prev, [projectId]: !currentlyExpanded };
      persistExpandedState(EXPANDED_STORAGE_KEY, next);
      return next;
    });
  };

  const toggleBrandExpanded = (brand) => {
    setBrandExpanded((prev) => {
      const currentlyExpanded = prev[brand] !== false;
      const next = { ...prev, [brand]: !currentlyExpanded };
      persistExpandedState(BRAND_EXPANDED_STORAGE_KEY, next);
      return next;
    });
  };

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
          <p className="sub">Brands, project teams, and module taxonomy for each project.</p>
        </div>
        <span className="spacer" />
        <Link href="/projects/new" className="btn btn-primary">
          <Icon name="plus" size={12} /> New project
        </Link>
      </div>
      <FormError error={error} />

      {loading ? (
        <p className="meta" role="status">Loading projects...</p>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <h3>No projects yet</h3>
          <p>Create a project to assign a team and define its module catalog.</p>
          <Link href="/projects/new" className="btn btn-primary">New project</Link>
        </div>
      ) : (
        brandGroups.map(({ brand, projects: brandProjects }) => {
          const isBrandExpanded = brandExpanded[brand] !== false;

          return (
            <section
              key={brand}
              className={`brand-group${isBrandExpanded ? '' : ' collapsed'}`}
            >
              <header className="brand-group-head">
                <h3 className="brand-group-title">
                  <button
                    type="button"
                    className="brand-group-toggle"
                    aria-expanded={isBrandExpanded}
                    aria-controls={`brand-body-${brand}`}
                    onClick={() => toggleBrandExpanded(brand)}
                  >
                    <span className="brand-group-chev" aria-hidden="true">
                      <Icon name="chev-right" size={14} />
                    </span>
                    <span>{brand}</span>
                    <span className="chip">{brandProjects.length}</span>
                    <span className="sr">{isBrandExpanded ? 'Collapse' : 'Expand'} {brand}</span>
                  </button>
                </h3>
              </header>

              <div className="brand-group-body" id={`brand-body-${brand}`}>
                {brandProjects.map((project) => {
                  const moduleRows = modulesDraft[project.id] ?? modulesToFormRows(project.modules);
                  const hasModuleDraft = Boolean(modulesDraft[project.id]);
                  const isExpanded = expanded[project.id] !== false;

                  return (
                    <ProjectPanel
                      key={project.id}
                      project={project}
                      teams={teams}
                      moduleRows={moduleRows}
                      hasModuleDraft={hasModuleDraft}
                      isExpanded={isExpanded}
                      onToggleExpanded={toggleExpanded}
                      onUpdate={update}
                      onSaveModules={saveModules}
                      onModulesChange={(projectId, rows) => setModulesDraft((prev) => ({ ...prev, [projectId]: rows }))}
                    />
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
