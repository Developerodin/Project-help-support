'use client';

import { useEffect, useRef, useState } from 'react';
import { useProject } from '@/shared/contexts/project-context.jsx';

function ChevronDown() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

export default function ProjectSwitcher() {
  const {
    projects, loading, activeProjectId, activeProject, setActiveProjectId,
  } = useProject();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function choose(projectId) {
    setActiveProjectId(projectId);
    setOpen(false);
  }

  const label = loading
    ? 'Loading…'
    : activeProject?.name ?? 'All projects';

  return (
    <div className="menuwrap" ref={wrapRef}>
      <button
        type="button"
        className="projsel"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Switch project"
        disabled={loading}
        onClick={() => setOpen((v) => !v)}
      >
        {activeProject && <span className="tag">{activeProject.key}</span>}
        <span>{label}</span>
        <ChevronDown />
      </button>

      {open && (
        <div className="menu on left" role="menu">
          <button
            type="button"
            className="menuitem"
            role="menuitem"
            aria-current={!activeProjectId ? 'true' : undefined}
            onClick={() => choose(null)}
          >
            All projects
            {!activeProjectId && <span className="k">✓</span>}
          </button>
          {projects.length > 0 && <div className="menusep" />}
          <div className="menuscroll">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className="menuitem"
                role="menuitem"
                aria-current={project.id === activeProjectId ? 'true' : undefined}
                onClick={() => choose(project.id)}
              >
                <span className="tag">{project.key}</span>
                <span>{project.name}</span>
                {project.id === activeProjectId && <span className="k">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
