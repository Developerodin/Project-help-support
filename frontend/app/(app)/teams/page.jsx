'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { can } from '@pms/shared';
import { listTeams, patchTeam, updateMembers } from '@/shared/api/teams.js';
import { listUsers } from '@/shared/api/users.js';
import FormError from '@/shared/components/form-error.jsx';
import ConfirmDialog from '@/shared/components/confirm-dialog.jsx';
import Icon from '@/shared/components/icons.jsx';
import AppLoader from '@/shared/components/app-loader.jsx';
import TeamCard from '@/shared/components/teams/team-card.jsx';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';

export default function TeamsPage() {
  const { user } = useAuth();
  const canCreate = can(user, 'teams.create');
  const canEdit = can(user, 'teams.edit');
  const canDelete = can(user, 'teams.delete');

  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [addBusyTeamId, setAddBusyTeamId] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState(null);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState('all');

  const reload = useCallback(() => {
    setLoading(true);
    return listTeams()
      .then((p) => setTeams(p.results))
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    reload();
    listUsers({ status: 'active' }).then((p) => setUsers(p.results)).catch(() => {});
  }, [user, reload]);

  const metrics = useMemo(() => {
    const onATeam = new Set(teams.flatMap((t) => t.members.map((m) => m.id)));
    return {
      teams: teams.length,
      people: onATeam.size,
      openTickets: teams.reduce((sum, t) => sum + (t.stats?.open ?? 0), 0),
      overdue: teams.reduce((sum, t) => sum + (t.stats?.overdue ?? 0), 0),
      unassigned: users.filter((u) => !onATeam.has(u.id)).length,
    };
  }, [teams, users]);

  const visibleTeams = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teams.filter((t) => {
      if (scope === 'global' && t.project) return false;
      if (scope === 'project' && !t.project) return false;
      if (scope === 'empty' && t.members.length > 0) return false;
      if (!q) return true;
      return t.name.toLowerCase().includes(q)
        || t.project?.name?.toLowerCase().includes(q)
        || t.members.some((m) => m.name.toLowerCase().includes(q));
    });
  }, [teams, search, scope]);
  const showOverview = loading || teams.length > 0;

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

  async function confirmDeleteTeam() {
    if (!confirmDelete) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await patchTeam(confirmDelete.id, { status: 'archived' });
      showToast(`${confirmDelete.name} deleted`);
      setConfirmDelete(null);
      await reload();
    } catch (err) {
      const message = normalizeApiError(err)?.message || 'Could not delete team';
      setError(err);
      showToast(message);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Teams</h1>
          <p className="sub">Route work to a group. A ticket may have a team, a person, or both.</p>
        </div>
        <span className="spacer" />
        {canCreate ? (
          <Link href="/teams/new" className="btn btn-primary">
            <Icon name="plus" size={12} /> New team
          </Link>
        ) : null}
      </div>
      <FormError error={error} />

      {showOverview && (
        <>
          <dl className="teams-metrics">
            <div><dt>Teams</dt><dd>{loading ? '—' : metrics.teams}</dd></div>
            <div><dt>People on a team</dt><dd>{loading ? '—' : metrics.people}</dd></div>
            <div><dt>Open tickets</dt><dd>{loading ? '—' : metrics.openTickets}</dd></div>
            <div>
              <dt>Overdue</dt>
              <dd className={!loading && metrics.overdue ? 'team-panel__overdue' : undefined}>{loading ? '—' : metrics.overdue}</dd>
            </div>
            <div><dt>Not on a team</dt><dd>{loading ? '—' : metrics.unassigned}</dd></div>
          </dl>

          <div className="teams-filters">
            <input
              type="search"
              placeholder="Search teams, projects or people…"
              aria-label="Search teams"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={loading}
            />
            <select aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value)} disabled={loading}>
              <option value="all">All teams</option>
              <option value="global">Global teams</option>
              <option value="project">Project teams</option>
              <option value="empty">Empty teams</option>
            </select>
          </div>
        </>
      )}

      {loading ? (
        <div className="loading-skeleton" aria-busy="true">
          <AppLoader inline label="Loading teams…" ariaLabel="Loading teams" />
        </div>
      ) : teams.length === 0 ? (
        <div className="empty-state">
          <h3>No teams yet</h3>
          <p>Create a team to route tickets to a group. Teams can be global or scoped to one project.</p>
          {canCreate ? (
            <Link href="/teams/new" className="btn btn-primary">New team</Link>
          ) : null}
        </div>
      ) : visibleTeams.length === 0 ? (
        <div className="empty-state">
          <h3>No teams match</h3>
          <p>Nothing here fits that search and scope. Clear the filters to see all {teams.length} teams.</p>
          <button type="button" className="btn" onClick={() => { setSearch(''); setScope('all'); }}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="teams-cards-grid">
          {visibleTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              users={users}
              canEdit={canEdit}
              canDelete={canDelete}
              onAddMembers={canEdit ? handleAddMembers : undefined}
              onRequestRemove={canEdit ? requestRemove : undefined}
              onDelete={canDelete ? () => setConfirmDelete(team) : undefined}
              addBusy={addBusyTeamId === team.id}
              removingMemberId={confirmRemove?.team.id === team.id ? removingMemberId : null}
            />
          ))}
        </div>
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
        open={Boolean(confirmDelete)}
        title={confirmDelete ? `Delete ${confirmDelete.name}?` : ''}
        message={confirmDelete
          ? 'This archives the team. Tickets already assigned keep their history.'
          : ''}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        danger
        busy={deleteBusy}
        onConfirm={confirmDeleteTeam}
        onCancel={() => { if (!deleteBusy) setConfirmDelete(null); }}
      />
    </>
  );
}
