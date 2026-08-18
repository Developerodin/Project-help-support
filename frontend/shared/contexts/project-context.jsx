'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { listProjects } from '../api/projects.js';
import { useAuth } from './auth-context.jsx';
import { isExternalUser } from '@pms/shared';
import {
  resolveInitialProjectId,
  writeStoredProjectId,
} from '../lib/active-project.js';

const ProjectContext = createContext(null);

export function ProjectProvider({ children }) {
  const { user } = useAuth();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeProjectId, setActiveProjectIdState] = useState(null);

  useEffect(() => {
    if (!user) {
      setProjects([]);
      setActiveProjectIdState(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    listProjects()
      .then((page) => {
        if (cancelled) return;
        const active = page.results.filter((p) => p.status === 'active');
        setProjects(active);
        const isExternal = isExternalUser(user);
        if (isExternal && active.length === 1) {
          setActiveProjectIdState(active[0].id);
          writeStoredProjectId(active[0].id);
        } else {
          setActiveProjectIdState(resolveInitialProjectId(active, { isExternal }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjects([]);
          setActiveProjectIdState(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [user]);

  const setActiveProjectId = useCallback((projectId) => {
    setActiveProjectIdState(projectId);
    writeStoredProjectId(projectId);
  }, []);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const isExternal = Boolean(user && isExternalUser(user));
  const hasWorkspace = !isExternal || projects.length > 0;

  const value = useMemo(() => ({
    projects,
    loading,
    activeProjectId,
    activeProject,
    setActiveProjectId,
    isExternal,
    hasWorkspace,
  }), [projects, loading, activeProjectId, activeProject, setActiveProjectId, isExternal, hasWorkspace]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) throw new Error('useProject must be used inside ProjectProvider');
  return context;
}
