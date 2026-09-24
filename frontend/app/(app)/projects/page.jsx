'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { can, canAccessProjectsModule, canManageProjectsModule } from '@pms/shared';
import { listClients, patchClient } from '@/shared/api/clients.js';
import { listProjects, patchProject } from '@/shared/api/projects.js';
import CompanyLogo from '@/shared/components/companies/company-logo.jsx';
import EditCompanyDialog from '@/shared/components/companies/edit-company-dialog.jsx';
import NewCompanyDialog from '@/shared/components/companies/new-company-dialog.jsx';
import ConfirmDialog from '@/shared/components/confirm-dialog.jsx';
import FormError from '@/shared/components/form-error.jsx';
import Icon from '@/shared/components/icons.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { usePermissionContext } from '@/shared/hooks/use-permission-context.js';
import { permissionContextForUi } from '@/shared/lib/permission-context-ui.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value.js';
import { projectsListUrlFromSearch, withProjectsReturn } from '@/shared/lib/projects-return-url.js';
import { useHistorySearch } from '@/shared/lib/use-history-search.js';

const COMPANY_EXPANDED_STORAGE_KEY = 'pms-companies-expanded';
const PROJECT_SEARCH_DEBOUNCE_MS = 300;
const PROJECT_PAGE_SIZES = [20, 50, 100];
const DEFAULT_PROJECT_LIMIT = 20;

function projectListQueryFromSearch(searchString) {
  const params = new URLSearchParams(searchString);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const limit = PROJECT_PAGE_SIZES.includes(Number(params.get('limit')))
    ? Number(params.get('limit'))
    : DEFAULT_PROJECT_LIMIT;
  const urlSearch = params.get('search') || '';
  return { page, limit, urlSearch };
}

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
  canEdit,
  canDelete,
  onDelete,
  listReturnUrl,
}) {
  return (
    <section className="panel project-panel">
      <header className="project-panel-head">
        <div className="project-panel-title-row">
          <h4 className="project-panel-title">
            <span className="project-panel-head-static">
              <span className="project-panel-head-label">
                <span className="mono">{project.key}</span> — {project.name}
              </span>
              <span className="spacer" />
              <span className="chip">{project.status}</span>
            </span>
          </h4>
          {canEdit || canDelete ? (
            <div className="project-panel-actions">
              {canEdit ? (
                <Link
                  href={withProjectsReturn(`/projects/${project.id}/edit`, listReturnUrl)}
                  className="btn btn-sm"
                >
                  Edit
                </Link>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  aria-label={`Archive ${project.key}`}
                  onClick={onDelete}
                >
                  Archive
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>
    </section>
  );
}

export default function ProjectsPage() {
  const { user, loading: authLoading } = useAuth();
  const { permissionContext } = usePermissionContext();
  const permCtx = permissionContextForUi(permissionContext);
  const pathname = usePathname();
  const searchString = useHistorySearch();
  const { page, limit, urlSearch } = useMemo(
    () => projectListQueryFromSearch(searchString),
    [searchString],
  );
  const listReturnUrl = useMemo(
    () => projectsListUrlFromSearch(searchString),
    [searchString],
  );

  const canViewProjects = Boolean(user && canAccessProjectsModule(user, permCtx ?? undefined));
  const canManageClients = Boolean(user && can(user, 'clients.manage', permCtx ?? undefined));
  const canManageProjects = Boolean(user && canManageProjectsModule(user, permCtx ?? undefined));

  const [searchInput, setSearchInput] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(searchInput, PROJECT_SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);

  const writeProjectSearch = useCallback((next) => {
    const params = new URLSearchParams(window.location.search);
    if (next.search) params.set('search', next.search);
    else params.delete('search');
    if (next.page) params.set('page', String(next.page));
    else params.delete('page');
    if (next.limit) params.set('limit', String(next.limit));
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    window.history.replaceState(null, '', url);
  }, [pathname]);

  // Write the URL only when the typed search settles, so a search arriving in the URL
  // (the assistant, back/forward) is not overwritten by the stale debounced value.
  const writtenSearch = useRef(debouncedSearch);
  useEffect(() => {
    if (debouncedSearch === writtenSearch.current) return;
    writtenSearch.current = debouncedSearch;
    if (debouncedSearch === urlSearch) return;
    writeProjectSearch({ search: debouncedSearch, page: 1 });
  }, [debouncedSearch, urlSearch, writeProjectSearch]);

  const [companies, setCompanies] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectPage, setProjectPage] = useState({
    totalResults: 0,
    totalPages: 1,
    resultsTruncated: false,
  });
  const [companyExpanded, setCompanyExpanded] = useState({});
  // A page past the end (the assistant's "last page", an old link) goes to the last one,
  // as Tickets and People do. Only once a real total is in, not the initial guess.
  useEffect(() => {
    if (!projectPage.loaded || page <= projectPage.totalPages) return;
    writeProjectSearch({ search: urlSearch, limit, page: Math.max(1, projectPage.totalPages) });
  }, [projectPage, page]); // Only a new total or page can put the page past the end.

  const [loading, setLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
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

  const applyLoadedData = useCallback((clientPage, projectListPage) => {
    const mergedCompanies = mergeCompaniesFromProjects(clientPage, projectListPage);
    setCompanies(mergedCompanies);
    setProjects(projectListPage.results ?? []);
    setProjectPage({
      totalResults: projectListPage.totalResults ?? 0,
      totalPages: projectListPage.totalPages ?? 1,
      resultsTruncated: Boolean(projectListPage.resultsTruncated),
      loaded: true,
    });
    setCompanyExpanded((prev) => mergeCompanyExpandedState(
      { ...readStoredExpanded(COMPANY_EXPANDED_STORAGE_KEY), ...prev },
      mergedCompanies.map((c) => c.id),
    ));
  }, []);

  const reload = useCallback(async () => {
    if (!user || !canViewProjects) return;

    setLoading(true);
    setError(null);
    setClientsAccessDenied(false);
    setLoadForbidden(false);
    setNetworkError(null);

    try {
      const [clientPage, projectListPage] = await Promise.all([
        fetchClientsForProjects(() => setClientsAccessDenied(true)),
        listProjects({
          page,
          limit,
          search: debouncedSearch || undefined,
        }),
      ]);
      applyLoadedData(clientPage, projectListPage);
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
  }, [applyLoadedData, canViewProjects, debouncedSearch, limit, page, user]);

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
          listProjects({
            page,
            limit,
            search: debouncedSearch || undefined,
          }),
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
        if (!cancelled) {
          setLoading(false);
          hasLoadedOnce.current = true;
        }
      }
    })();

    return () => { cancelled = true; };
  }, [applyLoadedData, authLoading, canViewProjects, debouncedSearch, limit, page, user]);

  const toggleCompanyExpanded = (companyId) => {
    setCompanyExpanded((prev) => {
      const currentlyExpanded = prev[companyId] !== false;
      const next = { ...prev, [companyId]: !currentlyExpanded };
      persistExpandedState(COMPANY_EXPANDED_STORAGE_KEY, next);
      return next;
    });
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
      showToast(`${confirmDeleteCompany.name} archived`);
      setConfirmDeleteCompany(null);
      await reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not archive company';
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
      showToast(`${confirmDeleteProject.key} archived`);
      setConfirmDeleteProject(null);
      await reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not archive project';
      setError(err);
      showToast(message);
    } finally {
      setDeleteProjectBusy(false);
    }
  }

  const pageBusy = authLoading || (canViewProjects && loading && !hasLoadedOnce.current);
  const listRefreshing = canViewProjects && loading && hasLoadedOnce.current;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Projects</h1>
          <p className="sub">Companies and projects. Open Edit to manage team, testers, and modules.</p>
        </div>
        <span className="spacer" />
        {canManageClients ? (
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
          <div className="projects-toolbar">
            <label className="projects-search">
              <span className="sr">Search projects</span>
              <input
                type="search"
                className="menusearch projects-search__input"
                placeholder="Search by name or key…"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                aria-label="Search projects"
                aria-busy={listRefreshing || undefined}
              />
            </label>
          </div>

          {projectPage.resultsTruncated ? (
            <div className="banner" role="status">
              <div className="banner-body">
                More projects match your access than are shown on this page. Use search or pagination to find them.
              </div>
            </div>
          ) : null}

          {clientsAccessDenied ? (
            <p className="meta" role="status">
              Company list is unavailable. Projects are grouped using company data from each project.
            </p>
          ) : null}

          <div aria-busy={listRefreshing || undefined}>
          {companies.length === 0 && projects.length === 0 && !listRefreshing ? (
            <div className="empty-state">
              <h3>No companies yet</h3>
              <p>Create a company, then add projects under it.</p>
              {canManageClients ? (
                <button type="button" className="btn btn-primary" onClick={() => setNewCompanyOpen(true)}>
                  New company
                </button>
              ) : null}
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
                        {canManageClients ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setEditCompany(company)}
                          >
                            Edit
                          </button>
                        ) : null}
                        {canManageClients ? (
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            aria-label={`Archive ${company.name}`}
                            onClick={() => setConfirmDeleteCompany(company)}
                          >
                            Archive
                          </button>
                        ) : null}
                        {canManageProjects ? (
                          <Link
                            href={withProjectsReturn(`/projects/new?clientId=${company.id}`, listReturnUrl)}
                            className="btn btn-sm btn-primary"
                          >
                            <Icon name="plus" size={12} /> Add project
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </header>

                  <div className="company-group-body" id={`company-body-${company.id}`}>
                    {companyProjects.length === 0 ? (
                      <p className="meta company-group-empty">
                        No projects yet.{' '}
                        <Link href={withProjectsReturn(`/projects/new?clientId=${company.id}`, listReturnUrl)}>
                          Add a project
                        </Link>
                      </p>
                    ) : (
                      companyProjects.map((project) => (
                        <ProjectPanel
                          key={project.id}
                          project={project}
                          canEdit={canManageProjects}
                          canDelete={canManageProjects}
                          listReturnUrl={listReturnUrl}
                          onDelete={() => setConfirmDeleteProject(project)}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })
          )}
          </div>

          <nav className="pager" aria-label="Projects pagination">
            <div className="pager__meta" aria-live="polite" aria-atomic="true">
              <span className="of">{projectPage.totalResults} projects</span>
              {(projectPage.totalPages || 1) > 1 ? (
                <span className="of">Page {page} of {projectPage.totalPages}</span>
              ) : null}
            </div>
            <div className="pager__controls">
              <label className="pagesize">
                <span className="pagesize__label">Rows</span>
                <select
                  aria-label="Projects per page"
                  value={limit}
                  disabled={loading}
                  onChange={(event) => {
                    writeProjectSearch({
                      search: urlSearch,
                      page: 1,
                      limit: Number(event.target.value),
                    });
                  }}
                >
                  {PROJECT_PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>{size} / page</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="pagebtn"
                disabled={loading || page <= 1}
                onClick={() => writeProjectSearch({ search: urlSearch, page: page - 1, limit })}
              >
                Previous
              </button>
              <button
                type="button"
                className="pagebtn"
                disabled={loading || page >= (projectPage.totalPages || 1)}
                onClick={() => writeProjectSearch({ search: urlSearch, page: page + 1, limit })}
              >
                Next
              </button>
            </div>
          </nav>
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
        title={confirmDeleteCompany ? `Archive ${confirmDeleteCompany.name}?` : ''}
        message={confirmDeleteCompany
          ? 'This archives the company and hides it from active listings. Its projects are also hidden from active project lists.'
          : ''}
        confirmLabel="Archive"
        cancelLabel="Cancel"
        danger
        busy={deleteCompanyBusy}
        onConfirm={confirmDeleteCompanyAction}
        onCancel={() => { if (!deleteCompanyBusy) setConfirmDeleteCompany(null); }}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteProject)}
        title={confirmDeleteProject ? `Archive ${confirmDeleteProject.key} — ${confirmDeleteProject.name}?` : ''}
        message={confirmDeleteProject
          ? 'This archives the project. Tickets already filed keep their history.'
          : ''}
        confirmLabel="Archive"
        cancelLabel="Cancel"
        danger
        busy={deleteProjectBusy}
        onConfirm={confirmDeleteProjectAction}
        onCancel={() => { if (!deleteProjectBusy) setConfirmDeleteProject(null); }}
      />
    </>
  );
}
