'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { initials } from '@/shared/components/icons.jsx';
import MemberPicker from '@/shared/components/teams/member-picker.jsx';

export default function TeamCard({
  team,
  users,
  onAddMembers,
  onRequestRemove,
  addBusy = false,
  removingMemberId = null,
}) {
  const memberIds = useMemo(() => new Set(team.members.map((m) => m.id)), [team.members]);
  const available = useMemo(
    () => users.filter((u) => !memberIds.has(u.id)),
    [users, memberIds],
  );

  return (
    <section className="panel team-panel">
      <header>
        <h3>{team.name}</h3>
        <span className="spacer" />
        <Link href={`/teams/${team.id}/edit`} className="btn btn-ghost btn-sm">Edit</Link>
        <span className="chip">{team.project ? team.project.key : 'global'}</span>
      </header>

      <dl className="team-panel__stats">
        <div>
          <dt>Members</dt>
          <dd>{team.members.length}</dd>
        </div>
        <div>
          <dt>Open tickets</dt>
          <dd>{team.stats?.open ?? 0}</dd>
        </div>
        <div>
          <dt>Overdue</dt>
          <dd className={team.stats?.overdue ? 'team-panel__overdue' : undefined}>
            {team.stats?.overdue ?? 0}
          </dd>
        </div>
        <div>
          <dt>Projects</dt>
          <dd>{team.projects?.length ?? (team.project ? 1 : 0)}</dd>
        </div>
      </dl>

      {team.lead ? (
        <p className="team-panel__lead">
          <span className="avatar sm">{initials(team.lead.name)}</span>
          <span>{team.lead.name}<span className="meta"> · lead</span></span>
        </p>
      ) : null}

      {team.projects?.length ? (
        <div className="team-panel__projects">
          <span className="lbl">Projects</span>
          <ul>
            {team.projects.map((project) => (
              <li key={project.id}>{project.name}</li>
            ))}
          </ul>
        </div>
      ) : team.project ? (
        <p className="team-panel__scope meta">Scoped to {team.project.name}</p>
      ) : null}

      <div className="team-members">
        <div className="team-panel__members-head">
          <span className="lbl">Members</span>
          <span className="meta">{team.members.length}</span>
        </div>

        {team.members.length === 0 ? (
          <p className="team-members__empty">Add people to route tickets to this team.</p>
        ) : (
          <ul className="team-members__list">
            {team.members.map((member) => {
              const removing = removingMemberId === member.id;
              return (
                <li key={member.id} className="member-chip">
                  <span className="avatar sm" title={member.name}>{initials(member.name)}</span>
                  <span className="member-chip__name">{member.name}</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm member-chip__remove"
                    aria-label={`Remove ${member.name}`}
                    disabled={removing || addBusy}
                    aria-busy={removing || undefined}
                    onClick={() => onRequestRemove(team, member)}
                  >
                    {removing ? (
                      <>
                        <span className="btn-spin" aria-hidden="true" />
                        Removing…
                      </>
                    ) : (
                      'Remove'
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="team-panel__add">
        <MemberPicker
          available={available}
          busy={addBusy}
          onConfirm={(ids) => onAddMembers(team.id, ids)}
        />
        {available.length === 0 && team.members.length > 0 && (
          <p className="field-hint">Everyone active is already on this team.</p>
        )}
      </div>
    </section>
  );
}
