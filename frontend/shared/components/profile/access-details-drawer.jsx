'use client';

import { useEffect } from 'react';
import { ENVIRONMENTS } from '@pms/shared';
import { capRole, capStatus } from '@/shared/lib/profile-utils.js';

export default function AccessDetailsDrawer({
  open,
  onClose,
  user,
  teams,
  projects,
  projectCount,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!user) return null;

  return (
    <>
      <div
        className={`scrim${open ? ' on' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-details-title"
        aria-hidden={!open}
        className={`drawer profile-access-drawer${open ? ' on' : ''}`}
      >
        <header className="drawer-head">
          <div className="drawer-id">
            <span className="id" id="access-details-title">Access details</span>
            <span className="spacer" />
            <div className="acts">
              <button type="button" className="btn btn-sm" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
          <p className="profile-access-drawer__intro">
            Read-only summary of your account access. Permissions are managed by administrators.
          </p>
        </header>

        <div className="drawer-body profile-access-drawer__body">
          <section className="profile-access-drawer__section" aria-label="Account">
            <h3 className="form-section">Account</h3>
            <dl className="profile-dl">
              <div className="profile-dl__row">
                <dt>System role</dt>
                <dd>{capRole(user.role)}</dd>
              </div>
              <div className="profile-dl__row">
                <dt>Account type</dt>
                <dd>{user.kind === 'reporter' ? 'Reporter' : 'Internal'}</dd>
              </div>
              <div className="profile-dl__row">
                <dt>Status</dt>
                <dd>{capStatus(user.status)}</dd>
              </div>
            </dl>
          </section>

          <section className="profile-access-drawer__section" aria-label="Scope">
            <h3 className="form-section">Scope</h3>
            <dl className="profile-dl">
              <div className="profile-dl__row">
                <dt>Teams</dt>
                <dd>{teams.length}</dd>
              </div>
              <div className="profile-dl__row">
                <dt>Projects</dt>
                <dd>{projectCount ?? projects.length}</dd>
              </div>
              <div className="profile-dl__row">
                <dt>Clients</dt>
                <dd className="profile-muted">Not configured</dd>
              </div>
              <div className="profile-dl__row">
                <dt>Environments</dt>
                <dd>{ENVIRONMENTS.join(', ')}</dd>
              </div>
            </dl>
            <p className="profile-access-drawer__note">
              Client-level access control is planned but not yet enabled. Ticket environments
              are set per issue when filing work.
            </p>
          </section>

          {teams.length > 0 && (
            <section className="profile-access-drawer__section" aria-label="Team memberships">
              <h3 className="form-section">Team memberships</h3>
              <ul className="profile-list">
                {teams.map((team) => (
                  <li key={team.id}>{team.name}</li>
                ))}
              </ul>
            </section>
          )}

          {projects.length > 0 && (
            <section className="profile-access-drawer__section" aria-label="Project associations">
              <h3 className="form-section">Project associations</h3>
              <ul className="profile-list">
                {projects.map((project) => (
                  <li key={project.id}>
                    <span className="profile-project-key">{project.key}</span>
                    {' '}
                    {project.name}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
