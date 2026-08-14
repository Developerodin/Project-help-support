'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { listTeams, updateMembers } from '@/shared/api/teams.js';
import { listUsers } from '@/shared/api/users.js';
import FormError from '@/shared/components/form-error.jsx';
import ConfirmDialog from '@/shared/components/confirm-dialog.jsx';
import Icon from '@/shared/components/icons.jsx';
import TeamCard from '@/shared/components/teams/team-card.jsx';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';

export default function TeamsPage() {
  const [teams, setTeams] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [addBusyTeamId, setAddBusyTeamId] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    return listTeams()
      .then((p) => setTeams(p.results))
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
    listUsers({ status: 'active' }).then((p) => setUsers(p.results)).catch(() => {});
  }, [reload]);

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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Teams</h1>
          <p className="sub">Route work to a group. A ticket may have a team, a person, or both.</p>
        </div>
        <span className="spacer" />
        <Link href="/teams/new" className="btn btn-primary">
          <Icon name="plus" size={12} /> New team
        </Link>
      </div>
      <FormError error={error} />

      {loading ? (
        <p className="meta" role="status">Loading teams…</p>
      ) : teams.length === 0 ? (
        <div className="empty-state">
          <h3>No teams yet</h3>
          <p>Create a team to route tickets to a group. Teams can be global or scoped to one project.</p>
          <Link href="/teams/new" className="btn btn-primary">New team</Link>
        </div>
      ) : (
        <div className="teams-cards-grid">
          {teams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              users={users}
              onAddMembers={handleAddMembers}
              onRequestRemove={requestRemove}
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
    </>
  );
}
