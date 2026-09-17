'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';
import { isExternalUser } from '@pms/shared';
import { fetchAllProjects } from '../lib/fetch-all-projects.js';
import { normalizeApiError } from '../lib/api-error.js';
import { useAuth } from './auth-context.jsx';
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  resolveInitialProjectId,
  writeStoredProjectId,
} from '../lib/active-project.js';

const ProjectContext = createContext(null);

export function ProjectProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const isExternal = Boolean(user && isExternalUser(user));
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [activeProjectId, setActiveProjectIdState] = useState(null);

  const loadProjects = useCallback(async () => {
    if (!userId) {
      setProjects([]);
      setActiveProjectIdState(null);
      setListError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setListError(null);
    try {
      const page = await fetchAllProjects({ status: 'active' });
      const active = page.results.filter((p) => p.status === 'active');
      setProjects(active);
      const nextProjectId = resolveInitialProjectId(active, { isExternal });
      setActiveProjectIdState(nextProjectId);
      writeStoredProjectId(nextProjectId);
    } catch (err) {
      setProjects([]);
      setActiveProjectIdState(null);
      setListError(normalizeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [userId, isExternal]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) {
        if (!cancelled) {
          setProjects([]);
          setActiveProjectIdState(null);
          setListError(null);
          setLoading(false);
        }
        return;
      }
      if (!cancelled) await loadProjects();
    })();
    return () => { cancelled = true; };
  }, [userId, isExternal, loadProjects]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    function onStorage(event) {
      if (event.key !== ACTIVE_PROJECT_STORAGE_KEY) return;
      const raw = event.newValue;
      if (!raw || raw === 'all') {
        setActiveProjectIdState(null);
        return;
      }
      if (projects.some((p) => p.id === raw)) {
        setActiveProjectIdState(raw);
      } else {
        setActiveProjectIdState(resolveInitialProjectId(projects, { isExternal }));
      }
    }

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [projects, isExternal]);

  const setActiveProjectId = useCallback((projectId) => {
    setActiveProjectIdState(projectId);
    writeStoredProjectId(projectId);
  }, []);

  const clearActiveProjectIfMissing = useCallback(() => {
    if (!activeProjectId) return;
    if (!projects.some((p) => p.id === activeProjectId)) {
      setActiveProjectId(null);
    }
  }, [activeProjectId, projects, setActiveProjectId]);

  useEffect(() => {
    clearActiveProjectIfMissing();
  }, [clearActiveProjectIfMissing]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const hasWorkspace = !isExternal || projects.length > 0;

  const value = useMemo(() => ({
    projects,
    loading,
    listError,
    reloadProjects: loadProjects,
    activeProjectId,
    activeProject,
    setActiveProjectId,
    clearActiveProjectIfMissing,
    isExternal,
    hasWorkspace,
  }), [
    projects, loading, listError, loadProjects, activeProjectId, activeProject,
    setActiveProjectId, clearActiveProjectIfMissing, isExternal, hasWorkspace,
  ]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject() {
  const context = useContext(ProjectContext);
  if (!context) throw new Error('useProject must be used inside ProjectProvider');
  return context;
}
