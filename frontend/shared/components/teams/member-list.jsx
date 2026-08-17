'use client';

import { useState } from 'react';
import { initials } from '@/shared/components/icons.jsx';

const COLLAPSE_AFTER = 8;

/**
 * Compact roster rows. Roles come from the account role the system already
 * has (User.role) — there is no team-scoped role model to read.
 */
export default function MemberList({
  members,
  onRemove,
  removeLabel = 'Remove',
  removingId = null,
  disabled = false,
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsed = !expanded && members.length > COLLAPSE_AFTER;
  const shown = collapsed ? members.slice(0, COLLAPSE_AFTER) : members;

  return (
    <>
      <ul className="member-rows">
        {shown.map((member) => {
          const removing = removingId === member.id;
          return (
            <li key={member.id} className="member-row">
              <span className="avatar" aria-hidden="true">{initials(member.name)}</span>
              <span className="member-row__who">
                <b>{member.name}</b>
                {member.email ? <span>{member.email}</span> : null}
              </span>
              {member.role ? <span className="chip member-row__role">{member.role}</span> : null}
              <button
                type="button"
                className={`btn btn-ghost btn-sm member-row__remove${removeLabel === '×' ? ' member-row__remove--icon' : ''}`}
                aria-label={`Remove ${member.name}`}
                disabled={disabled || removing}
                aria-busy={removing || undefined}
                onClick={() => onRemove(member)}
              >
                {removing ? <span className="btn-spin" aria-hidden="true" /> : removeLabel}
              </button>
            </li>
          );
        })}
      </ul>

      {members.length > COLLAPSE_AFTER ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded((v) => !v)}>
          {collapsed ? `View all ${members.length} members` : 'Show fewer'}
        </button>
      ) : null}
    </>
  );
}
