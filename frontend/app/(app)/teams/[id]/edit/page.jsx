'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { can } from '@pms/shared';
import { getTeam, patchTeam, updateMembers } from '@/shared/api/teams.js';
import { fetchAllProjects } from '@/shared/lib/fetch-all-projects.js';
import FormError from '@/shared/components/form-error.jsx';
import TeamForm from '@/shared/components/teams/team-form.jsx';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { usePermissionContext } from '@/shared/hooks/use-permission-context.js';
import { permissionContextForUi } from '@/shared/lib/permission-context-ui.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { parseTeamsReturnUrl, TEAMS_RETURN_PARAM } from '@/shared/lib/teams-return-url.js';
import { showToast } from '@/shared/lib/toast.js';

export default function EditTeamPage() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const teamId = params.id;
  const teamsReturnUrl = parseTeamsReturnUrl(searchParams.get(TEAMS_RETURN_PARAM));
  const { user } = useAuth();
  const { permissionContext } = usePermissionContext();
  const permCtx = permissionContextForUi(permissionContext);
  const canEdit = Boolean(user && can(user, 'teams.edit', permCtx ?? undefined));
  const canView = Boolean(user && can(user, 'teams.view', permCtx ?? undefined));

  const [team, setTeam] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectsError, setProjectsError] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [memberBusy, setMemberBusy] = useState(null);
  const [memberNotice, setMemberNotice] = useState(null);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getTeam(teamId)
      .then(setTeam)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [teamId, canView]);

  useEffect(() => {
    fetchAllProjects({ status: 'active' })
      .then((p) => setProjects(p.results))
      .catch(() => setProjectsError(true));
  }, []);

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

  function handleAddMembers(ids, pickedUsers = []) {
    const byId = new Map(pickedUsers.map((u) => [u.id, u]));
    const added = ids.map((id) => byId.get(id) || { id, name: 'Unknown' });
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
      router.push(teamsReturnUrl);
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

  if (!canView) {
    return (
      <div className="team-form-page">
        <div className="empty-state">
          <h3>Permission required</h3>
          <p>You need teams.view to open team settings.</p>
        </div>
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
      busy={busy}
      error={error}
      memberBusy={memberBusy}
      memberNotice={memberNotice}
      canEdit={canEdit}
      teamsReturnUrl={teamsReturnUrl}
      onSubmit={handleSubmit}
      onCancel={() => router.push(teamsReturnUrl)}
      onAddMembers={canEdit ? handleAddMembers : undefined}
      onRemoveMember={canEdit ? handleRemoveMember : undefined}
    />
  );
}
