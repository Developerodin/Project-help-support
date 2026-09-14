'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createTeam } from '@/shared/api/teams.js';
import { listProjects } from '@/shared/api/projects.js';
import TeamForm from '@/shared/components/teams/team-form.jsx';
import { showToast } from '@/shared/lib/toast.js';

export default function NewTeamPage() {
  const router = useRouter();
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listProjects()
      .then((p) => setProjects(p.results.filter((proj) => proj.status === 'active')))
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
      router.push('/teams');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TeamForm
      mode="create"
      projects={projects}
      projectsLoading={projectsLoading}
      projectsError={projectsError}
      busy={busy}
      error={error}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
    />
  );
}
