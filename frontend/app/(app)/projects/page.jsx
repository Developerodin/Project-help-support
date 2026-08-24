'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { can, canAccessProjectsModule } from '@pms/shared';
import { listClients, patchClient } from '@/shared/api/clients.js';
import { listProjects, patchProject, replaceModules } from '@/shared/api/projects.js';
import { listTeams } from '@/shared/api/teams.js';
import CompanyLogo from '@/shared/components/companies/company-logo.jsx';
import EditCompanyDialog from '@/shared/components/companies/edit-company-dialog.jsx';
import NewCompanyDialog from '@/shared/components/companies/new-company-dialog.jsx';
import ConfirmDialog from '@/shared/components/confirm-dialog.jsx';
import FormError from '@/shared/components/form-error.jsx';
import Icon from '@/shared/components/icons.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';
import ProjectTeamPanel from '@/shared/components/projects/project-team-panel.jsx';
import ProjectClientTestersPanel from '@/shared/components/projects/project-client-testers-panel.jsx';
import ProjectModulesEditor from '@/shared/components/project-modules-editor.jsx';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { formRowsToModules, modulesToFormRows } from '@/shared/lib/project-modules.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';

const EXPANDED_STORAGE_KEY = 'pms-projects-expanded';
const COMPANY_EXPANDED_STORAGE_KEY = 'pms-companies-expanded';

function isForbiddenError(error) {
  return normalizeApiError(error)?.status === 403;
}

function isNetworkError(error) {
  const normalized = normalizeApiError(error);
  return Boolean(normalized && !normalized.status);
}

async function fetchClientsForProjects(onUnavailable) {
  try {
    return await listClients({ status: 'active' });
  } catch (err) {
    if (isForbiddenError(err) || isNetworkError(err)) {
      onUnavailable();
      return { results: [] };
    }
    throw err;
  }
}

function mergeCompaniesFromProjects(clientPage, projectPage) {
  const companyById = new Map((clientPage.results ?? []).map((company) => [company.id, company]));
  for (const project of projectPage.results ?? []) {
    const client = project.client;
    const companyId = client?.id ?? client;
    if (companyId && typeof client === 'object' && client.name && !companyById.has(companyId)) {
      companyById.set(companyId, client);
    }
  }
  return [...companyById.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function mergeExpandedState(prev, projectIds) {
  const next = { ...prev };
  for (const id of projectIds) {
    if (!(id in next)) next[id] = true;
  }
  return next;
}

function mergeCompanyExpandedState(prev, companyIds) {
  const next = { ...prev };
  for (const id of companyIds) {
    if (!(id in next)) next[id] = true;
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
  canDelete,
  onToggleExpanded,
  onDelete,
  onUpdate,
  onSaveModules,
  onModulesChange,
}) {
  return (
    <section
      className={`panel project-panel${isExpanded ? '' : ' collapsed'}`}
    >
      <header className="project-panel-head">
        <div className="project-panel-title-row">
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
          {canDelete ? (
            <div className="project-panel-actions">
              <button type="button" className="btn btn-sm btn-danger" onClick={onDelete}>
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="project-form" id={`project-body-${project.id}`}>
        <div className="project-form-section">
          <div className="project-form-intro">
            <h5 className="project-form-heading">Project team</h5>
            <p className="project-form-hint">
              Assign one team to this project. Member roles come from each person&apos;s profile.
            </p>
          </div>

          <ProjectTeamPanel project={project} teams={teams} onUpdated={onUpdate} />
        </div>

        <div className="project-form-section">
          <ProjectClientTestersPanel project={project} />
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
  const { user, loading: authLoading } = useAuth();
  const canViewProjects = Boolean(user && canAccessProjectsModule(user));
  const canManageClients = Boolean(user && can(user, 'clients.manage'));
  const canManageProjects = Boolean(user && can(user, 'projects.manage'));

  const [companies, setCompanies] = useState([]);
  const [projects, setProjects] = useState([]);
  const [teams, setTeams] = useState([]);
  const [modulesDraft, setModulesDraft] = useState({});
  const [expanded, setExpanded] = useState({});
  const [companyExpanded, setCompanyExpanded] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [clientsAccessDenied, setClientsAccessDenied] = useState(false);
  const [loadForbidden, setLoadForbidden] = useState(false);
  const [networkError, setNetworkError] = useState(null);
  const [newCompanyOpen, setNewCompanyOpen] = useState(false);
  const [editCompany, setEditCompany] = useState(null);
  const [confirmDeleteCompany, setConfirmDeleteCompany] = useState(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(null);
  const [deleteCompanyBusy, setDeleteCompanyBusy] = useState(false);
  const [deleteProjectBusy, setDeleteProjectBusy] = useState(false);

  const companyGroups = useMemo(() => {
    const projectMap = new Map();
    for (const project of projects) {
      const companyId = project.client?.id ?? project.client;
      if (!companyId) continue;
      if (!projectMap.has(companyId)) projectMap.set(companyId, []);
      projectMap.get(companyId).push(project);
    }

    return companies
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((company) => ({
        company,
        projects: (projectMap.get(company.id) ?? []).sort((a, b) => a.key.localeCompare(b.key)),
      }));
  }, [companies, projects]);

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

  const applyLoadedData = useCallback((clientPage, projectPage) => {
    const mergedCompanies = mergeCompaniesFromProjects(clientPage, projectPage);
    setCompanies(mergedCompanies);
    setProjects(projectPage.results ?? []);
    syncModulesDraft(projectPage.results ?? []);
    setExpanded((prev) => mergeExpandedState(
      { ...readStoredExpanded(EXPANDED_STORAGE_KEY), ...prev },
      (projectPage.results ?? []).map((x) => x.id),
    ));
    setCompanyExpanded((prev) => mergeCompanyExpandedState(
      { ...readStoredExpanded(COMPANY_EXPANDED_STORAGE_KEY), ...prev },
      mergedCompanies.map((c) => c.id),
    ));
  }, [syncModulesDraft]);

  const reload = useCallback(async () => {
    if (!user || !canViewProjects) return;

    setLoading(true);
    setError(null);
    setClientsAccessDenied(false);
    setLoadForbidden(false);
    setNetworkError(null);

    try {
      const [clientPage, projectPage] = await Promise.all([
        fetchClientsForProjects(() => setClientsAccessDenied(true)),
        listProjects(),
      ]);
      applyLoadedData(clientPage, projectPage);
    } catch (err) {
      if (isForbiddenError(err)) {
        setLoadForbidden(true);
      } else if (isNetworkError(err)) {
        setNetworkError(normalizeApiError(err));
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }, [applyLoadedData, canViewProjects, user]);

  useEffect(() => {
    if (authLoading || !user) return undefined;
    if (!canViewProjects) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setClientsAccessDenied(false);
      setLoadForbidden(false);
      setNetworkError(null);

      try {
        const [clientPage, projectPage] = await Promise.all([
          fetchClientsForProjects(() => {
            if (!cancelled) setClientsAccessDenied(true);
          }),
          listProjects(),
        ]);
        if (!cancelled) applyLoadedData(clientPage, projectPage);
      } catch (err) {
        if (cancelled) return;
        if (isForbiddenError(err)) {
          setLoadForbidden(true);
        } else if (isNetworkError(err)) {
          setNetworkError(normalizeApiError(err));
        } else {
          setError(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [applyLoadedData, authLoading, canViewProjects, user]);

  useEffect(() => {
    if (authLoading || !user || !canViewProjects) return undefined;
    let cancelled = false;
    listTeams()
      .then((page) => {
        if (!cancelled) setTeams(page.results ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [authLoading, canViewProjects, user]);

  const toggleExpanded = (projectId) => {
    setExpanded((prev) => {
      const currentlyExpanded = prev[projectId] !== false;
      const next = { ...prev, [projectId]: !currentlyExpanded };
      persistExpandedState(EXPANDED_STORAGE_KEY, next);
      return next;
    });
  };

  const toggleCompanyExpanded = (companyId) => {
    setCompanyExpanded((prev) => {
      const currentlyExpanded = prev[companyId] !== false;
      const next = { ...prev, [companyId]: !currentlyExpanded };
      persistExpandedState(COMPANY_EXPANDED_STORAGE_KEY, next);
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

  const onCompanyCreated = (company) => {
    showToast(`Company ${company.name} created`);
    reload();
  };

  const onCompanyUpdated = (company) => {
    setCompanies((prev) => prev.map((c) => (c.id === company.id ? company : c)));
    showToast(`Company ${company.name} updated`);
  };

  async function confirmDeleteCompanyAction() {
    if (!confirmDeleteCompany) return;
    setDeleteCompanyBusy(true);
    setError(null);
    try {
      await patchClient(confirmDeleteCompany.id, { status: 'archived' });
      showToast(`${confirmDeleteCompany.name} deleted`);
      setConfirmDeleteCompany(null);
      await reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not delete company';
      setError(err);
      showToast(message);
    } finally {
      setDeleteCompanyBusy(false);
    }
  }

  async function confirmDeleteProjectAction() {
    if (!confirmDeleteProject) return;
    setDeleteProjectBusy(true);
    setError(null);
    try {
      await patchProject(confirmDeleteProject.id, { status: 'archived' });
      showToast(`${confirmDeleteProject.key} deleted`);
      setConfirmDeleteProject(null);
      await reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not delete project';
      setError(err);
      showToast(message);
    } finally {
      setDeleteProjectBusy(false);
    }
  }

  const pageBusy = authLoading || (canViewProjects && loading);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="sub">Companies, project teams, and module taxonomy for each project.</p>
        </div>
        <span className="spacer" />
        {canViewProjects ? (
          <button type="button" className="btn btn-primary" onClick={() => setNewCompanyOpen(true)}>
            <Icon name="plus" size={12} /> New company
          </button>
        ) : null}
      </div>
      <FormError error={error} />

      {pageBusy ? (
        <div className="loading-skeleton" aria-busy="true">
          <AppLoader inline label="Loading projects…" ariaLabel="Loading projects" />
        </div>
      ) : !canViewProjects ? (
        <div className="empty-state">
          <h3>Permission required</h3>
          <p>You need both company and project view permissions to access this page.</p>
        </div>
      ) : loadForbidden ? (
        <div className="empty-state">
          <h3>Permission denied</h3>
          <p>You do not have permission to view projects.</p>
        </div>
      ) : networkError ? (
        <div className="banner" role="alert">
          <Icon name="alert" size={16} aria-hidden="true" />
          <div className="banner-body">
            <b>Could not load projects</b>
            <div>{networkError.message || 'Check your connection and try again.'}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={reload}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {clientsAccessDenied ? (
            <p className="meta" role="status">
              Company list is unavailable. Projects are grouped using company data from each project.
            </p>
          ) : null}

          {companies.length === 0 && projects.length === 0 ? (
            <div className="empty-state">
              <h3>No companies yet</h3>
              <p>Create a company, then add projects under it.</p>
              <button type="button" className="btn btn-primary" onClick={() => setNewCompanyOpen(true)}>
                New company
              </button>
            </div>
          ) : (
            companyGroups.map(({ company, projects: companyProjects }) => {
              const isCompanyExpanded = companyExpanded[company.id] !== false;
              const projectCount = companyProjects.length;

              return (
                <section
                  key={company.id}
                  className={`company-group${isCompanyExpanded ? '' : ' collapsed'}`}
                >
                  <header className="company-group-head">
                    <div className="company-group-title-row">
                      <button
                        type="button"
                        className="company-group-toggle"
                        aria-expanded={isCompanyExpanded}
                        aria-controls={`company-body-${company.id}`}
                        onClick={() => toggleCompanyExpanded(company.id)}
                      >
                        <span className="company-group-chev" aria-hidden="true">
                          <Icon name="chev-right" size={14} />
                        </span>
                        <CompanyLogo company={company} size={28} />
                        <span>{company.name}</span>
                        <span className="chip">{company.status}</span>
                        <span className="chip">{projectCount}</span>
                        <span className="sr">
                          {isCompanyExpanded ? 'Collapse' : 'Expand'} {company.name}
                        </span>
                      </button>
                      <div className="company-group-actions">
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setEditCompany(company)}
                        >
                          Edit
                        </button>
                        {canManageClients ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => setConfirmDeleteCompany(company)}
                          >
                            Delete
                          </button>
                        ) : null}
                        <Link
                          href={`/projects/new?clientId=${company.id}`}
                          className="btn btn-sm btn-primary"
                        >
                          <Icon name="plus" size={12} /> Add project
                        </Link>
                      </div>
                    </div>
                  </header>

                  <div className="company-group-body" id={`company-body-${company.id}`}>
                    {companyProjects.length === 0 ? (
                      <p className="meta company-group-empty">
                        No projects yet.{' '}
                        <Link href={`/projects/new?clientId=${company.id}`}>Add a project</Link>
                      </p>
                    ) : (
                      companyProjects.map((project) => {
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
                            canDelete={canManageProjects}
                            onToggleExpanded={toggleExpanded}
                            onDelete={() => setConfirmDeleteProject(project)}
                            onUpdate={update}
                            onSaveModules={saveModules}
                            onModulesChange={(projectId, rows) => setModulesDraft((prev) => ({ ...prev, [projectId]: rows }))}
                          />
                        );
                      })
                    )}
                  </div>
                </section>
              );
            })
          )}
        </>
      )}

      <NewCompanyDialog
        open={newCompanyOpen}
        onClose={() => setNewCompanyOpen(false)}
        onCreated={onCompanyCreated}
      />

      <EditCompanyDialog
        open={Boolean(editCompany)}
        company={editCompany}
        onClose={() => setEditCompany(null)}
        onUpdated={onCompanyUpdated}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteCompany)}
        title={confirmDeleteCompany ? `Delete ${confirmDeleteCompany.name}?` : ''}
        message={confirmDeleteCompany
          ? 'This archives the company and hides it from active listings. Its projects are also hidden from active project lists.'
          : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        busy={deleteCompanyBusy}
        onConfirm={confirmDeleteCompanyAction}
        onCancel={() => { if (!deleteCompanyBusy) setConfirmDeleteCompany(null); }}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteProject)}
        title={confirmDeleteProject ? `Delete ${confirmDeleteProject.key} — ${confirmDeleteProject.name}?` : ''}
        message={confirmDeleteProject
          ? 'This archives the project. Tickets already filed keep their history.'
          : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        busy={deleteProjectBusy}
        onConfirm={confirmDeleteProjectAction}
        onCancel={() => { if (!deleteProjectBusy) setConfirmDeleteProject(null); }}
      />
    </>
  );
}
