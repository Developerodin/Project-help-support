'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getTeam, patchTeam, updateMembers } from '@/shared/api/teams.js';
import { listProjects } from '@/shared/api/projects.js';
import { listUsers } from '@/shared/api/users.js';
import FormError from '@/shared/components/form-error.jsx';
import TeamForm from '@/shared/components/teams/team-form.jsx';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';

export default function EditTeamPage() {
  const router = useRouter();
  const params = useParams();
  const teamId = params.id;

  const [team, setTeam] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectsError, setProjectsError] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [memberBusy, setMemberBusy] = useState(null);
  const [memberNotice, setMemberNotice] = useState(null);

  useEffect(() => {
    setLoading(true);
    getTeam(teamId)
      .then(setTeam)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [teamId]);

  useEffect(() => {
    listProjects()
      .then((p) => setProjects(p.results.filter((proj) => proj.status === 'active')))
      .catch(() => setProjectsError(true));
  }, []);

  useEffect(() => {
    listUsers({ status: 'active' })
      .then((p) => setUsers(p.results))
      .catch(() => {})
      .finally(() => setUsersLoading(false));
  }, []);

  /**
   * Membership edits are their own PATCH, applied optimistically and rolled
   * back on failure — the roster never silently diverges from the server, and
   * nothing here reloads the page.
   */
  async function runMemberChange({ optimistic, request, busyKey, failure, success }) {
    const previous = team;
    setMemberNotice(null);
    setMemberBusy(busyKey);
    setTeam((prev) => ({ ...prev, members: optimistic(prev.members) }));
    try {
      const updated = await request();
      setTeam(updated);
      showToast(success);
    } catch (err) {
      setTeam(previous);
      setMemberNotice({
        message: normalizeApiError(err)?.message || failure,
        onRetry: () => runMemberChange({ optimistic, request, busyKey, failure, success }),
      });
    } finally {
      setMemberBusy(null);
    }
  }

  function handleAddMembers(ids) {
    const added = users.filter((u) => ids.includes(u.id));
    return runMemberChange({
      busyKey: 'add',
      optimistic: (current) => [...current, ...added],
      request: () => updateMembers(teamId, { add: ids }),
      failure: `Could not add ${ids.length === 1 ? 'that member' : `those ${ids.length} members`}.`,
      success: ids.length === 1 ? 'Member added' : `${ids.length} members added`,
    });
  }

  function handleRemoveMember(member) {
    return runMemberChange({
      busyKey: member.id,
      optimistic: (current) => current.filter((m) => m.id !== member.id),
      request: () => updateMembers(teamId, { remove: [member.id] }),
      failure: `Could not remove ${member.name}.`,
      success: `${member.name} removed`,
    });
  }

  async function handleSubmit(payload) {
    setBusy(true);
    setError(null);
    try {
      await patchTeam(teamId, payload);
      showToast('Team updated');
      router.push('/teams');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="team-form-page">
        <p className="loading-skeleton meta" role="status">Loading team…</p>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="team-form-page">
        <FormError error={error} />
      </div>
    );
  }

  return (
    <TeamForm
      key={team.id}
      mode="edit"
      team={team}
      projects={projects}
      projectsError={projectsError}
      users={users}
      usersLoading={usersLoading}
      busy={busy}
      error={error}
      memberBusy={memberBusy}
      memberNotice={memberNotice}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      onAddMembers={handleAddMembers}
      onRemoveMember={handleRemoveMember}
    />
  );
}
