'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isExternalUser } from '@pms/shared';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { useProject } from '@/shared/contexts/project-context.jsx';
import { groupProjectsByCompany } from '@/shared/lib/group-projects-by-company.js';

function ChevronDown() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export default function ProjectSwitcher() {
  const { user } = useAuth();
  const {
    projects, loading, listError, reloadProjects,
    activeProjectId, activeProject, setActiveProjectId,
  } = useProject();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const [focusIndex, setFocusIndex] = useState(-1);

  const isExternal = isExternalUser(user);
  const canSwitch = !isExternal || projects.length > 1;

  const filteredProjects = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q),
    );
  }, [projects, filter]);

  const menuEntries = useMemo(() => {
    const entries = [];
    if (!isExternal) {
      entries.push({ type: 'all', id: '__all__', label: 'All projects' });
    }
    for (const { company, projects: companyProjects } of groupProjectsByCompany(filteredProjects)) {
      entries.push({ type: 'brand', id: `brand-${company.id ?? company.name}`, label: company.name });
      for (const project of companyProjects) {
        entries.push({ type: 'project', id: project.id, project });
      }
    }
    return entries;
  }, [filteredProjects, isExternal]);

  const focusableIndices = useMemo(
    () => menuEntries
      .map((entry, index) => (entry.type === 'project' || entry.type === 'all' ? index : -1))
      .filter((index) => index >= 0),
    [menuEntries],
  );

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setFilter('');
      setFocusIndex(-1);
    }
  }, [open]);

  useEffect(() => {
    if (!open || focusIndex < 0) return;
    const buttons = menuRef.current?.querySelectorAll('[data-menu-focusable="true"]');
    buttons?.[focusIndex]?.focus();
  }, [focusIndex, open]);

  function choose(projectId) {
    setActiveProjectId(projectId);
    setOpen(false);
  }

  function onMenuKeyDown(event) {
    if (!focusableIndices.length) return;
    const currentPos = focusableIndices.indexOf(focusIndex);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = currentPos < 0 ? 0 : (currentPos + 1) % focusableIndices.length;
      setFocusIndex(focusableIndices[next]);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = currentPos <= 0
        ? focusableIndices[focusableIndices.length - 1]
        : focusableIndices[currentPos - 1];
      setFocusIndex(next);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setFocusIndex(focusableIndices[0]);
    } else if (event.key === 'End') {
      event.preventDefault();
      setFocusIndex(focusableIndices[focusableIndices.length - 1]);
    }
  }

  const label = loading
    ? 'Loading…'
    : activeProject?.name ?? (isExternal ? 'Project' : 'All projects');

  const triggerAriaLabel = activeProject
    ? `Current project: ${activeProject.key} ${activeProject.name}. Switch project`
    : 'All projects. Switch project';

  if (listError) {
    return (
      <div className="projsel projsel-error" role="alert">
        <span className="projsel-error-text">Projects unavailable</span>
        <button type="button" className="btn btn-sm" onClick={reloadProjects}>
          Retry
        </button>
      </div>
    );
  }

  if (isExternal && projects.length === 1) {
    if (loading) {
      return (
        <div className="projsel projsel-readonly" aria-busy="true" aria-label="Loading project">
          <span>Loading…</span>
        </div>
      );
    }
    if (activeProject) {
      return (
        <div
          className="projsel projsel-readonly"
          aria-label={`Current project: ${activeProject.key} ${activeProject.name}`}
        >
          {activeProject && <span className="tag">{activeProject.key}</span>}
          <span className="projsel-name">{activeProject.name}</span>
        </div>
      );
    }
    return null;
  }

  if (!canSwitch) return null;

  return (
    <div className="menuwrap" ref={wrapRef}>
      <button
        type="button"
        className="projsel"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerAriaLabel}
        disabled={loading}
        onClick={() => setOpen((v) => !v)}
      >
        {activeProject && <span className="tag">{activeProject.key}</span>}
        <span className="projsel-name">{label}</span>
        <ChevronDown />
      </button>

      {open && (
        <div
          className="menu on left wide"
          role="menu"
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
        >
          <input
            type="search"
            className="menusearch"
            placeholder="Search projects…"
            value={filter}
            aria-label="Filter projects"
            onChange={(event) => setFilter(event.target.value)}
          />
          {!isExternal ? (
            <button
              type="button"
              className="menuitem"
              role="menuitem"
              data-menu-focusable="true"
              tabIndex={focusIndex === 0 ? 0 : -1}
              aria-current={!activeProjectId ? 'true' : undefined}
              onClick={() => choose(null)}
              onFocus={() => setFocusIndex(0)}
            >
              All projects
              {!activeProjectId && <span className="k">✓</span>}
            </button>
          ) : null}
          {filteredProjects.length > 0 && !isExternal && <div className="menusep" />}
          <div className="menuscroll">
            {groupProjectsByCompany(filteredProjects).map(({ company, projects: companyProjects }) => (
              <div key={company.id ?? company.name} className="menubrand">
                <div className="menubrand-label" role="presentation">{company.name}</div>
                {companyProjects.map((project) => {
                  const entryIndex = menuEntries.findIndex(
                    (e) => e.type === 'project' && e.id === project.id,
                  );
                  const focusablePos = focusableIndices.indexOf(entryIndex);
                  return (
                    <button
                      key={project.id}
                      type="button"
                      className="menuitem menuitem-nested"
                      role="menuitem"
                      data-menu-focusable="true"
                      tabIndex={focusIndex === focusablePos ? 0 : -1}
                      aria-current={project.id === activeProjectId ? 'true' : undefined}
                      aria-label={`${project.key} ${project.name}`}
                      onClick={() => choose(project.id)}
                      onFocus={() => setFocusIndex(focusablePos)}
                    >
                      <span className="tag">{project.key}</span>
                      <span>{project.name}</span>
                      {project.id === activeProjectId && <span className="k">✓</span>}
                    </button>
                  );
                })}
              </div>
            ))}
            {filteredProjects.length === 0 ? (
              <p className="meta menu-empty">No projects match your search.</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
