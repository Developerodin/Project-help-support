'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import { updateMe } from '@/shared/api/users.js';
import { listTeams } from '@/shared/api/teams.js';
import { listProjects } from '@/shared/api/projects.js';
import AccessDetailsDrawer from '@/shared/components/profile/access-details-drawer.jsx';
import ThemeToggle from '@/shared/components/theme-toggle.jsx';
import FormError from '@/shared/components/form-error.jsx';
import { initials } from '@/shared/components/icons.jsx';
import { formatDateOnly, formatWhen } from '@/shared/components/tickets/ticket-drawer-utils.js';
import { formatRelativeTime } from '@/shared/lib/notification-utils.js';
import {
  canAccessProjects,
  canAccessTeams,
  capRole,
  capStatus,
  collectProjectsFromTeams,
  filterUserTeams,
  maskUserId,
} from '@/shared/lib/profile-utils.js';
import { showToast } from '@/shared/lib/toast.js';

function StatusChip({ status }) {
  const label = capStatus(status);
  const className = status === 'active' ? 'chip chip-on' : 'chip';
  return <span className={className}>{label}</span>;
}

function DetailRow({ label, children }) {
  return (
    <div className="profile-dl__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Panel({ title, description, children, id }) {
  return (
    <section className="panel profile-panel" aria-labelledby={id}>
      <header className="profile-panel__head">
        <h2 id={id}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

export default function ProfilePage() {
  const personalInfoId = useId();
  const { user, logout, refreshUser } = useAuth();
  const nameInputRef = useRef(null);

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [teams, setTeams] = useState([]);
  const [projectCount, setProjectCount] = useState(null);
  const [workLoading, setWorkLoading] = useState(true);
  const [accessOpen, setAccessOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (user) setName(user.name || '');
  }, [user?.id, user?.name]);

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;

    (async () => {
      setWorkLoading(true);
      try {
        await refreshUser();
        const [teamsPage, projectsPage] = await Promise.all([
          listTeams({ limit: 100 }),
          canAccessProjects(user.role) ? listProjects({ limit: 1 }) : Promise.resolve(null),
        ]);
        if (!cancelled) {
          setTeams(teamsPage?.results || []);
          setProjectCount(projectsPage?.totalResults ?? null);
        }
      } catch {
        if (!cancelled) {
          setTeams([]);
          setProjectCount(null);
        }
      } finally {
        if (!cancelled) setWorkLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id, user?.role, refreshUser]);

  const trimmed = name.trim();
  const nameChanged = trimmed !== (user?.name || '').trim();
  const userTeams = user ? filterUserTeams(teams, user.id) : [];
  const userProjects = collectProjectsFromTeams(userTeams);
  const resolvedProjectCount = canAccessProjects(user?.role)
    ? projectCount
    : userProjects.length;

  const scrollToPersonalInfo = useCallback(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  async function saveName(event) {
    event.preventDefault();
    if (!trimmed || !nameChanged) return;
    setError(null);
    setBusy(true);
    try {
      const updated = await updateMe({ name: trimmed });
      await refreshUser(updated);
      showToast('Profile updated');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await logout();
  }

  async function copyAccountId() {
    if (!user?.id || !navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(user.id);
      setCopied(true);
      showToast('Account ID copied');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Could not copy account ID');
    }
  }

  if (!user) return null;

  const showTeamsLink = canAccessTeams(user.role);
  const showProjectsLink = canAccessProjects(user.role);

  return (
    <div className="profile-page">
      <nav className="crumb" aria-label="Breadcrumb">
        <span aria-current="page">Profile</span>
      </nav>

      <div className="page-head">
        <div>
          <h1>Your profile</h1>
          <p className="sub">Account details, work context, and personal preferences.</p>
        </div>
      </div>

      <section className="panel profile-page__header" aria-label="Profile overview">
        <div className="profile-page__header-main">
          <span className="avatar lg" aria-hidden="true">{initials(user.name || user.email)}</span>
          <div className="profile-page__header-copy">
            <h2>{user.name || 'Unnamed'}</h2>
            <p className="meta">{user.email}</p>
            <div className="profile-page__badges">
              <span className="chip">{capRole(user.role)}</span>
              <StatusChip status={user.status} />
            </div>
            {user.lastLoginAt ? (
              <p className="profile-page__meta-line">
                Last signed in
                {' '}
                <time dateTime={user.lastLoginAt}>{formatRelativeTime(user.lastLoginAt)}</time>
                {' '}
                <span className="profile-muted">({formatWhen(user.lastLoginAt)})</span>
              </p>
            ) : (
              <p className="profile-page__meta-line profile-muted">Last sign-in not recorded yet</p>
            )}
          </div>
          <span className="spacer" />
          <button type="button" className="btn" onClick={scrollToPersonalInfo}>
            Edit profile
          </button>
        </div>
      </section>

      <div className="profile-page__columns">
        <div className="profile-page__column">
          <Panel
            id={personalInfoId}
            title="Personal information"
            description="Update how your name appears across the app."
          >
            <div className="profile-panel__body">
              <form className="profile-page__form" onSubmit={saveName}>
                <FormError error={error} />
                <div className="form-row">
                  <label htmlFor="profile-name">Full name</label>
                  <input
                    ref={nameInputRef}
                    id="profile-name"
                    className="input"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    disabled={busy}
                    minLength={1}
                    required
                  />
                </div>
                <div className="form-row">
                  <label htmlFor="profile-email">Email</label>
                  <input
                    id="profile-email"
                    className="input"
                    type="email"
                    value={user.email}
                    readOnly
                    aria-readonly="true"
                  />
                  <p className="help">Email changes require administrator support or a verification flow.</p>
                </div>
                <div className="profile-page__actions">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={busy || !trimmed || !nameChanged}
                    aria-busy={busy || undefined}
                  >
                    {busy ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            </div>
          </Panel>

          <Panel
            id="profile-work"
            title="Work profile"
            description="Your role and team associations in this workspace."
          >
            <dl className="profile-dl profile-panel__body">
              <DetailRow label="Role">{capRole(user.role)}</DetailRow>
              <DetailRow label="Teams">
                {workLoading ? (
                  <span className="profile-muted">Loading…</span>
                ) : userTeams.length === 0 ? (
                  <span className="profile-muted">No team memberships</span>
                ) : (
                  <ul className="profile-list profile-list--inline">
                    {userTeams.map((team) => (
                      <li key={team.id}>{team.name}</li>
                    ))}
                  </ul>
                )}
              </DetailRow>
              <DetailRow label="Projects">
                {workLoading ? (
                  <span className="profile-muted">Loading…</span>
                ) : userProjects.length === 0 ? (
                  <span className="profile-muted">No linked projects</span>
                ) : (
                  <ul className="profile-list profile-list--inline">
                    {userProjects.map((project) => (
                      <li key={project.id}>
                        <span className="profile-project-key">{project.key}</span>
                        {' '}
                        {project.name}
                      </li>
                    ))}
                  </ul>
                )}
              </DetailRow>
            </dl>
            {(showTeamsLink || showProjectsLink) && (
              <div className="profile-panel__footer">
                {showTeamsLink ? (
                  <Link href="/teams" className="btn btn-sm">View teams</Link>
                ) : null}
                {showProjectsLink ? (
                  <Link href="/projects" className="btn btn-sm">View projects</Link>
                ) : null}
              </div>
            )}
          </Panel>

          <Panel
            id="profile-preferences"
            title="Preferences"
            description="Appearance and notification settings for your account."
          >
            <div className="profile-panel__body">
              <div className="profile-setting">
                <div className="profile-setting__info">
                  <strong>Theme</strong>
                  <p>Switch between light and dark mode.</p>
                </div>
                <ThemeToggle />
              </div>
              <div className="profile-setting">
                <div className="profile-setting__info">
                  <strong>Notifications</strong>
                  <p>Choose which events reach you by email and in the app.</p>
                </div>
                <Link href="/settings/notifications" className="btn btn-sm">
                  Manage
                </Link>
              </div>
            </div>
          </Panel>
        </div>

        <div className="profile-page__column">
          <Panel
            id="profile-access"
            title="Access and permissions"
            description="Read-only summary of what your account can reach."
          >
            <dl className="profile-dl profile-panel__body">
              <DetailRow label="System role">{capRole(user.role)}</DetailRow>
              <DetailRow label="Teams">{workLoading ? '…' : userTeams.length}</DetailRow>
              <DetailRow label="Projects">
                {workLoading ? '…' : (resolvedProjectCount ?? userProjects.length)}
              </DetailRow>
              <DetailRow label="Clients">
                <span className="profile-muted">Not configured</span>
              </DetailRow>
              <DetailRow label="Environments">
                <span className="profile-muted">Per ticket</span>
              </DetailRow>
            </dl>
            <div className="profile-panel__footer">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setAccessOpen(true)}
              >
                View access details
              </button>
            </div>
          </Panel>

          <Panel
            id="profile-security"
            title="Security"
            description="Password, sessions, and sign-out."
          >
            <div className="profile-panel__body">
              <div className="profile-setting">
                <div className="profile-setting__info">
                  <strong>Password</strong>
                  <p>Request a reset link to choose a new password.</p>
                </div>
                <Link href="/forgot-password" className="btn btn-sm">
                  Change password
                </Link>
              </div>
              <div className="profile-setting profile-setting--disabled">
                <div className="profile-setting__info">
                  <strong>Active sessions</strong>
                  <p>Session management is not available yet.</p>
                </div>
                <button type="button" className="btn btn-sm" disabled>
                  Coming soon
                </button>
              </div>
              <div className="profile-setting profile-setting--disabled">
                <div className="profile-setting__info">
                  <strong>Two-factor authentication</strong>
                  <p>Extra sign-in protection is not available yet.</p>
                </div>
                <button type="button" className="btn btn-sm" disabled>
                  Coming soon
                </button>
              </div>
            </div>
            <div className="profile-panel__footer profile-panel__footer--separated">
              <button type="button" className="btn danger" onClick={handleLogout}>
                Sign out
              </button>
            </div>
          </Panel>

          <Panel
            id="profile-account"
            title="Account"
            description="Identifiers and membership details."
          >
            <dl className="profile-dl profile-panel__body">
              <DetailRow label="Account ID">
                <span className="profile-id-copy">
                  <code>{maskUserId(user.id)}</code>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={copyAccountId}
                    aria-label="Copy full account ID"
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </span>
              </DetailRow>
              <DetailRow label="Member since">
                {user.createdAt ? (
                  <time dateTime={user.createdAt}>{formatDateOnly(user.createdAt)}</time>
                ) : (
                  <span className="profile-muted">—</span>
                )}
              </DetailRow>
              <DetailRow label="Status">
                <StatusChip status={user.status} />
              </DetailRow>
            </dl>
          </Panel>
        </div>
      </div>

      <AccessDetailsDrawer
        open={accessOpen}
        onClose={() => setAccessOpen(false)}
        user={user}
        teams={userTeams}
        projects={userProjects}
        projectCount={resolvedProjectCount}
      />
    </div>
  );
}
