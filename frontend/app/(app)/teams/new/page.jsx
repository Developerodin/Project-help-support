'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { can } from '@pms/shared';
import { createTeam } from '@/shared/api/teams.js';
import { fetchAllProjects } from '@/shared/lib/fetch-all-projects.js';
import TeamForm from '@/shared/components/teams/team-form.jsx';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { usePermissionContext } from '@/shared/hooks/use-permission-context.js';
import { permissionContextForUi } from '@/shared/lib/permission-context-ui.js';
import { parseTeamsReturnUrl, TEAMS_RETURN_PARAM } from '@/shared/lib/teams-return-url.js';
import { showToast } from '@/shared/lib/toast.js';

export default function NewTeamPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const teamsReturnUrl = parseTeamsReturnUrl(searchParams.get(TEAMS_RETURN_PARAM));
  const { user } = useAuth();
  const { permissionContext } = usePermissionContext();
  const permCtx = permissionContextForUi(permissionContext);
  const canCreate = Boolean(user && can(user, 'teams.create', permCtx ?? undefined));

  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAllProjects({ status: 'active' })
      .then((p) => setProjects(p.results))
      .catch(() => setProjectsError(true))
      .finally(() => setProjectsLoading(false));
  }, []);

  async function handleSubmit(payload) {
    setBusy(true);
    setError(null);
    try {
      await createTeam(payload);
      showToast(payload.members?.length
        ? `Team created with ${payload.members.length} ${payload.members.length === 1 ? 'member' : 'members'}`
        : 'Team created');
      router.push(teamsReturnUrl);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (user && !canCreate) {
    return (
      <div className="empty-state">
        <h3>Permission required</h3>
        <p>You need teams.create to create a team.</p>
      </div>
    );
  }

  return (
    <TeamForm
      mode="create"
      projects={projects}
      projectsLoading={projectsLoading}
      projectsError={projectsError}
      busy={busy}
      error={error}
      teamsReturnUrl={teamsReturnUrl}
      onSubmit={handleSubmit}
      onCancel={() => router.push(teamsReturnUrl)}
    />
  );
}
