'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { initials } from '@/shared/components/icons.jsx';
import MemberPicker from '@/shared/components/teams/member-picker.jsx';
import { withTeamsReturn } from '@/shared/lib/teams-return-url.js';

export default function TeamCard({
  team,
  canEdit = false,
  canDelete = false,
  listReturnUrl = '/teams',
  onAddMembers,
  onRequestRemove,
  onDelete,
  addBusy = false,
  removingMemberId = null,
}) {
  const excludeMemberIds = useMemo(
    () => team.members.map((m) => m.id),
    [team.members],
  );

  return (
    <section className="panel team-panel">
      <header className="team-panel__head">
        <div className="team-panel__title-row">
          <h3 className="team-panel__name">{team.name}</h3>
          <span className="chip team-panel__key">
            {team.project ? team.project.key : 'global'}
          </span>
          {(canEdit || canDelete) ? (
            <div className="team-panel__actions">
              {canEdit ? (
                <Link
                  href={withTeamsReturn(`/teams/${team.id}/edit`, listReturnUrl)}
                  className="btn btn-ghost"
                >
                  Edit
                </Link>
              ) : null}
              {canDelete ? (
                <button type="button" className="btn btn-ghost" onClick={() => onDelete?.()}>
                  Archive
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
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

      {team.lead && canEdit ? (
        <p className="team-panel__lead meta">
          Lead: {team.lead.name}
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
                  {canEdit ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm member-chip__remove"
                      aria-label={`Remove ${member.name}`}
                      disabled={removing || addBusy}
                      aria-busy={removing || undefined}
                      onClick={() => onRequestRemove?.(team, member)}
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
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canEdit ? (
        <div className="team-panel__add">
          <MemberPicker
            serverSearch
            excludeMemberIds={excludeMemberIds}
            busy={addBusy}
            onConfirm={(ids) => onAddMembers?.(team.id, ids)}
          />
        </div>
      ) : null}
    </section>
  );
}
