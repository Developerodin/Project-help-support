'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { can } from '@pms/shared';
import { listTeams, patchTeam, updateMembers } from '@/shared/api/teams.js';
import { listUsers } from '@/shared/api/users.js';
import FormError from '@/shared/components/form-error.jsx';
import ConfirmDialog from '@/shared/components/confirm-dialog.jsx';
import Icon from '@/shared/components/icons.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';
import TeamCard from '@/shared/components/teams/team-card.jsx';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { usePermissionContext } from '@/shared/hooks/use-permission-context.js';
import { permissionContextForUi } from '@/shared/lib/permission-context-ui.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { fetchAllTeams } from '@/shared/lib/fetch-all-teams.js';
import { showToast } from '@/shared/lib/toast.js';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value.js';
import { teamsListUrlFromSearch, withTeamsReturn } from '@/shared/lib/teams-return-url.js';
import { useHistorySearch } from '@/shared/lib/use-history-search.js';

const TEAM_SEARCH_DEBOUNCE_MS = 300;
const TEAM_PAGE_SIZES = [20, 50, 100];
const DEFAULT_TEAM_LIMIT = 20;
const TEAM_SCOPES = ['all', 'global', 'project', 'empty'];

function teamListQueryFromSearch(searchString) {
  const params = new URLSearchParams(searchString);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const limit = TEAM_PAGE_SIZES.includes(Number(params.get('limit')))
    ? Number(params.get('limit'))
    : DEFAULT_TEAM_LIMIT;
  const urlSearch = params.get('search') || params.get('q') || '';
  const scope = TEAM_SCOPES.includes(params.get('scope')) ? params.get('scope') : 'all';
  const status = params.get('status') === 'archived' ? 'archived' : 'active';
  return { page, limit, urlSearch, scope, status };
}

function isForbiddenError(error) {
  return normalizeApiError(error)?.status === 403;
}

function isNetworkError(error) {
  const normalized = normalizeApiError(error);
  return Boolean(normalized && !normalized.status);
}

export default function TeamsPage() {
  const { user, loading: authLoading } = useAuth();
  const { permissionContext } = usePermissionContext();
  const permCtx = permissionContextForUi(permissionContext);
  const pathname = usePathname();
  const searchString = useHistorySearch();
  const { page, limit, urlSearch, scope, status } = useMemo(
    () => teamListQueryFromSearch(searchString),
    [searchString],
  );
  const listReturnUrl = useMemo(
    () => teamsListUrlFromSearch(searchString),
    [searchString],
  );

  const canViewTeams = Boolean(user && can(user, 'teams.view', permCtx ?? undefined));
  const canCreate = Boolean(user && can(user, 'teams.create', permCtx ?? undefined));
  const canEdit = Boolean(user && can(user, 'teams.edit', permCtx ?? undefined));
  const canDelete = Boolean(user && can(user, 'teams.delete', permCtx ?? undefined));

  const [searchInput, setSearchInput] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(searchInput, TEAM_SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    setSearchInput(urlSearch);
  }, [urlSearch]);

  const writeTeamsSearch = useCallback((next) => {
    const params = new URLSearchParams(window.location.search);
    if (next.search) params.set('search', next.search);
    else params.delete('search');
    params.delete('q');
    if (next.page) params.set('page', String(next.page));
    else params.delete('page');
    if (next.limit) params.set('limit', String(next.limit));
    else params.delete('limit');
    if (next.scope && next.scope !== 'all') params.set('scope', next.scope);
    else params.delete('scope');
    if (next.status === 'archived') params.set('status', 'archived');
    else params.delete('status');
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
    writeTeamsSearch({
      search: debouncedSearch,
      page: 1,
      limit,
      scope,
      status,
    });
  }, [debouncedSearch, urlSearch, writeTeamsSearch, limit, scope, status]);

  const [teams, setTeams] = useState([]);
  const [teamPage, setTeamPage] = useState({
    totalResults: 0,
    totalPages: 1,
    resultsTruncated: false,
  });
  const [metrics, setMetrics] = useState(null);
  // A page past the end (the assistant's "last page", an old link) goes to the last one,
  // as Tickets and People do. Only once a real total is in, not the initial guess.
  useEffect(() => {
    if (!teamPage.loaded || page <= teamPage.totalPages) return;
    writeTeamsSearch({ search: urlSearch, limit, scope, status, page: Math.max(1, teamPage.totalPages) });
  }, [teamPage, page]); // Only a new total or page can put the page past the end.

  const [activeUserTotal, setActiveUserTotal] = useState(null);
  const [loading, setLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  const [error, setError] = useState(null);
  const [loadForbidden, setLoadForbidden] = useState(false);
  const [networkError, setNetworkError] = useState(null);
  const [addBusyTeamId, setAddBusyTeamId] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState(null);

  const reloadMetrics = useCallback(async () => {
    if (!canViewTeams) return;
    try {
      const [allTeams, usersPage] = await Promise.all([
        fetchAllTeams({ status }),
        listUsers({ status: 'active', limit: 1 }).catch(() => ({ totalResults: null })),
      ]);
      const onATeam = new Set(allTeams.results.flatMap((t) => t.members.map((m) => m.id)));
      const userTotal = usersPage.totalResults ?? activeUserTotal;
      setActiveUserTotal(userTotal);
      setMetrics({
        teams: allTeams.totalResults,
        people: onATeam.size,
        openTickets: allTeams.results.reduce((sum, t) => sum + (t.stats?.open ?? 0), 0),
        overdue: allTeams.results.reduce((sum, t) => sum + (t.stats?.overdue ?? 0), 0),
        unassigned: userTotal != null ? Math.max(0, userTotal - onATeam.size) : null,
      });
    } catch {
      setMetrics(null);
    }
  }, [activeUserTotal, canViewTeams, status]);

  const reload = useCallback(async () => {
    if (!user || !canViewTeams) return;

    setLoading(true);
    setError(null);
    setLoadForbidden(false);
    setNetworkError(null);

    try {
      const listPage = await listTeams({
        page,
        limit,
        search: debouncedSearch || undefined,
        scope: scope === 'all' ? undefined : scope,
        status,
      });
      setTeams(listPage.results ?? []);
      setTeamPage({
        totalResults: listPage.totalResults ?? 0,
        totalPages: listPage.totalPages ?? 1,
        resultsTruncated: Boolean(listPage.resultsTruncated),
        loaded: true,
      });
      await reloadMetrics();
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
  }, [canViewTeams, debouncedSearch, limit, page, reloadMetrics, scope, status, user]);

  useEffect(() => {
    if (authLoading || !user) return undefined;
    if (!canViewTeams) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setLoadForbidden(false);
      setNetworkError(null);

      try {
        const listPage = await listTeams({
          page,
          limit,
          search: debouncedSearch || undefined,
          scope: scope === 'all' ? undefined : scope,
          status,
        });
        if (!cancelled) {
          setTeams(listPage.results ?? []);
          setTeamPage({
            totalResults: listPage.totalResults ?? 0,
            totalPages: listPage.totalPages ?? 1,
            resultsTruncated: Boolean(listPage.resultsTruncated),
            loaded: true,
          });
        }
        if (!cancelled) await reloadMetrics();
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
  }, [authLoading, canViewTeams, debouncedSearch, limit, page, reloadMetrics, scope, status, user]);

  async function handleAddMembers(teamId, userIds) {
    setError(null);
    setAddBusyTeamId(teamId);
    try {
      await updateMembers(teamId, { add: userIds });
      const count = userIds.length;
      showToast(count === 1 ? 'Member added' : `${count} members added`);
      await reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not add members';
      setError(err);
      showToast(message);
      throw err;
    } finally {
      setAddBusyTeamId(null);
    }
  }

  function requestRemove(team, member) {
    setConfirmRemove({ team, member });
  }

  async function confirmRemoveMember() {
    if (!confirmRemove) return;
    const { team, member } = confirmRemove;
    setRemoveBusy(true);
    setRemovingMemberId(member.id);
    setError(null);
    try {
      await updateMembers(team.id, { remove: [member.id] });
      showToast(`${member.name} removed from ${team.name}`);
      setConfirmRemove(null);
      await reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not remove member';
      setError(err);
      showToast(message);
    } finally {
      setRemoveBusy(false);
      setRemovingMemberId(null);
    }
  }

  async function confirmArchiveTeam() {
    if (!confirmArchive) return;
    setArchiveBusy(true);
    setError(null);
    try {
      await patchTeam(confirmArchive.id, { status: 'archived' });
      showToast(`${confirmArchive.name} archived`);
      setConfirmArchive(null);
      await reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not archive team';
      setError(err);
      showToast(message);
    } finally {
      setArchiveBusy(false);
    }
  }

  const pageBusy = authLoading || (canViewTeams && loading && !hasLoadedOnce.current);
  const listRefreshing = canViewTeams && loading && hasLoadedOnce.current;
  const showOverview = pageBusy || teamPage.totalResults > 0 || status === 'archived' || debouncedSearch || scope !== 'all';

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Teams</h1>
          <p className="sub">Route work to a group. A ticket may have a team, a person, or both.</p>
        </div>
        <span className="spacer" />
        {canCreate ? (
          <Link href={withTeamsReturn('/teams/new', listReturnUrl)} className="btn btn-primary">
            <Icon name="plus" size={12} /> New team
          </Link>
        ) : null}
      </div>
      <FormError error={error} />

      {pageBusy ? (
        <div className="loading-skeleton" aria-busy="true">
          <AppLoader inline label="Loading teams…" ariaLabel="Loading teams" />
        </div>
      ) : !canViewTeams ? (
        <div className="empty-state">
          <h3>Permission required</h3>
          <p>You need teams.view to access this page.</p>
        </div>
      ) : loadForbidden ? (
        <div className="empty-state">
          <h3>Permission denied</h3>
          <p>You do not have permission to view teams.</p>
        </div>
      ) : networkError ? (
        <div className="banner" role="alert">
          <Icon name="alert" size={16} aria-hidden="true" />
          <div className="banner-body">
            <b>Could not load teams</b>
            <div>{networkError.message || 'Check your connection and try again.'}</div>
          </div>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={reload}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {showOverview ? (
            <>
              <dl className="teams-metrics">
                <div><dt>Teams</dt><dd>{metrics ? metrics.teams : '—'}</dd></div>
                <div><dt>People on a team</dt><dd>{metrics ? metrics.people : '—'}</dd></div>
                <div><dt>Open tickets</dt><dd>{metrics ? metrics.openTickets : '—'}</dd></div>
                <div>
                  <dt>Overdue</dt>
                  <dd className={metrics?.overdue ? 'team-panel__overdue' : undefined}>
                    {metrics ? metrics.overdue : '—'}
                  </dd>
                </div>
                <div>
                  <dt>Not on a team</dt>
                  <dd>{metrics?.unassigned == null ? '—' : metrics.unassigned}</dd>
                </div>
              </dl>

              <div className="teams-toolbar">
                <label className="projects-search teams-toolbar__search">
                  <span className="sr">Search teams</span>
                  <input
                    type="search"
                    className="menusearch projects-search__input"
                    placeholder="Search teams, projects or people…"
                    aria-label="Search teams"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    aria-busy={listRefreshing || undefined}
                  />
                </label>
                <select
                  className="teams-toolbar__scope"
                  aria-label="Team scope"
                  value={scope}
                  disabled={loading}
                  onChange={(event) => {
                    writeTeamsSearch({
                      search: urlSearch,
                      page: 1,
                      limit,
                      scope: event.target.value,
                      status,
                    });
                  }}
                >
                  <option value="all">All teams</option>
                  <option value="global">Global teams</option>
                  <option value="project">Project teams</option>
                  <option value="empty">Empty teams</option>
                </select>
                <div className="seg teams-toolbar__status" role="group" aria-label="Team status">
                  <button
                    type="button"
                    aria-pressed={status === 'active'}
                    onClick={() => writeTeamsSearch({
                      search: urlSearch, page: 1, limit, scope, status: 'active',
                    })}
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    aria-pressed={status === 'archived'}
                    onClick={() => writeTeamsSearch({
                      search: urlSearch, page: 1, limit, scope, status: 'archived',
                    })}
                  >
                    Archived
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {teamPage.resultsTruncated ? (
            <div className="banner" role="status">
              <div className="banner-body">
                More teams match your access than are shown on this page. Use search or pagination to find them.
              </div>
            </div>
          ) : null}

          <div aria-busy={listRefreshing || undefined}>
            {teams.length === 0 && !listRefreshing && (urlSearch || scope !== 'all') ? (
              // Filters matched nothing: "No teams yet" would be wrong when teams exist.
              <div className="empty-state">
                <h3>No teams match</h3>
                <p>Nothing here fits that search and scope.</p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setSearchInput('');
                    writeTeamsSearch({
                      search: '', page: 1, limit, scope: 'all', status,
                    });
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : teams.length === 0 && !listRefreshing ? (
              <div className="empty-state">
                <h3>{status === 'archived' ? 'No archived teams' : 'No teams yet'}</h3>
                <p>
                  {status === 'archived'
                    ? 'Archived teams are hidden from the active list.'
                    : 'Create a team to route tickets to a group. Teams can be global or scoped to one project.'}
                </p>
                {canCreate && status === 'active' ? (
                  <Link href={withTeamsReturn('/teams/new', listReturnUrl)} className="btn btn-primary">
                    New team
                  </Link>
                ) : null}
              </div>
            ) : (
              <div className="teams-cards-grid">
                {teams.map((team) => (
                  <TeamCard
                    key={team.id}
                    team={team}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    listReturnUrl={listReturnUrl}
                    onAddMembers={canEdit ? handleAddMembers : undefined}
                    onRequestRemove={canEdit ? requestRemove : undefined}
                    onDelete={canDelete ? () => setConfirmArchive(team) : undefined}
                    addBusy={addBusyTeamId === team.id}
                    removingMemberId={confirmRemove?.team.id === team.id ? removingMemberId : null}
                  />
                ))}
              </div>
            )}
          </div>

          <nav className="pager" aria-label="Teams pagination">
            <div className="pager__meta" aria-live="polite" aria-atomic="true">
              <span className="of">{teamPage.totalResults} teams</span>
              {(teamPage.totalPages || 1) > 1 ? (
                <span className="of">Page {page} of {teamPage.totalPages}</span>
              ) : null}
            </div>
            <div className="pager__controls">
              <label className="pagesize">
                <span className="pagesize__label">Rows</span>
                <select
                  aria-label="Teams per page"
                  value={limit}
                  disabled={loading}
                  onChange={(event) => {
                    writeTeamsSearch({
                      search: urlSearch,
                      page: 1,
                      limit: Number(event.target.value),
                      scope,
                      status,
                    });
                  }}
                >
                  {TEAM_PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>{size} / page</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="pagebtn"
                disabled={loading || page <= 1}
                onClick={() => writeTeamsSearch({ search: urlSearch, page: page - 1, limit, scope, status })}
              >
                Previous
              </button>
              <button
                type="button"
                className="pagebtn"
                disabled={loading || page >= (teamPage.totalPages || 1)}
                onClick={() => writeTeamsSearch({ search: urlSearch, page: page + 1, limit, scope, status })}
              >
                Next
              </button>
            </div>
          </nav>
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirmRemove)}
        title={confirmRemove ? `Remove ${confirmRemove.member.name}?` : ''}
        message={confirmRemove
          ? `They will no longer receive tickets routed to ${confirmRemove.team.name}.`
          : ''}
        confirmLabel="Remove"
        cancelLabel="Cancel"
        danger
        busy={removeBusy}
        onConfirm={confirmRemoveMember}
        onCancel={() => { if (!removeBusy) setConfirmRemove(null); }}
      />

      <ConfirmDialog
        open={Boolean(confirmArchive)}
        title={confirmArchive ? `Archive ${confirmArchive.name}?` : ''}
        message={confirmArchive
          ? 'This archives the team. Tickets already assigned keep their history.'
          : ''}
        confirmLabel="Archive"
        cancelLabel="Cancel"
        danger
        busy={archiveBusy}
        onConfirm={confirmArchiveTeam}
        onCancel={() => { if (!archiveBusy) setConfirmArchive(null); }}
      />
    </>
  );
}
