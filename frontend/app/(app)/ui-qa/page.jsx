'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { isExternalUser } from '@pms/shared';
import AppLoader from '@/shared/components/app-loader.jsx';
import { UiQaReviewWorkspace } from '@/shared/components/ui-qa/ui-qa-hierarchy.jsx';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { useProject } from '@/shared/contexts/project-context.jsx';
import { getUiQaProject } from '@/shared/api/ui-qa.js';
import { normalizeApiError } from '@/shared/lib/api-error.js';

function UiQaPageContent() {
  const { user } = useAuth();
  const { activeProjectId, activeProject, projects, loading: projectsLoading, isExternal } = useProject();
  const [projectData, setProjectData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadProject = useCallback(async () => {
    if (!activeProjectId) {
      setProjectData(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await getUiQaProject(activeProjectId);
      setProjectData(data);
    } catch (err) {
      setProjectData(null);
      setError(normalizeApiError(err)?.message || 'Could not load UI & QA data');
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  const needsProject = !isExternal || projects.length > 1;

  return (
    <div className="page ui-qa-page">
      <header className="page-head">
        <div>
          <h1>UI &amp; QA</h1>
          <p className="page-lead">
            Track visual inspection and QA feedback across modules, pages, and screens.
          </p>
        </div>
      </header>

      {projectsLoading ? <AppLoader label="Loading projects…" /> : null}

      {!projectsLoading && needsProject && !activeProjectId ? (
        <div className="ui-qa-empty-state">
          <h2>Select a project</h2>
          <p>Use the project switcher in the top bar to choose which catalog to inspect.</p>
        </div>
      ) : null}

      {!projectsLoading && activeProjectId && loading ? (
        <AppLoader label="Loading module hierarchy…" />
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      {!projectsLoading && activeProjectId && !loading && projectData ? (
        <>
          <div className="ui-qa-project-banner">
            <span className="tag">{activeProject?.key || projectData.key}</span>
            <strong>{activeProject?.name || projectData.name}</strong>
          </div>
          <UiQaReviewWorkspace
            projectId={activeProjectId}
            modules={projectData.modules || []}
            user={user}
            onUpdated={loadProject}
          />
        </>
      ) : null}

      {!projectsLoading && !needsProject && projects.length === 0 ? (
        <div className="ui-qa-empty-state">
          <h2>No projects available</h2>
          <p>{isExternalUser(user) ? 'You do not have access to any projects yet.' : 'Create a project to begin UI & QA tracking.'}</p>
        </div>
      ) : null}
    </div>
  );
}

export default function UiQaPage() {
  return (
    <Suspense fallback={<AppLoader label="Loading UI & QA…" />}>
      <UiQaPageContent />
    </Suspense>
  );
}
