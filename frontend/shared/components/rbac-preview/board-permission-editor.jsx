'use client';

import {
  BOARD_KEYS,
  BOARD_LABELS,
  BOARD_CAPABILITY_LABELS,
  EXTERNAL_ROLES,
} from '@pms/shared';
import { boardHasCapability } from '@/shared/lib/rbac-preview/board-permissions-utils.js';

const CAPS_FOR_BOARD = (board) => (
  board === 'qa'
    ? ['operate', 'transition', 'qa_approve', 'qa_reject']
    : ['operate', 'transition']
);

export default function BoardPermissionEditor({
  role,
  snapshot,
  mode = 'view',
  onToggleCapability,
  embedded = false,
}) {
  if (EXTERNAL_ROLES.includes(role)) {
    return null;
  }

  const table = (
    <div className="rbac-role-permissions__table-wrap">
      <table className="rbac-board-role__table">
        <thead>
          <tr>
            <th scope="col">Board lane</th>
            <th scope="col">Capabilities</th>
          </tr>
        </thead>
        <tbody>
          {BOARD_KEYS.map((board) => (
            <tr key={board}>
              <th scope="row">{BOARD_LABELS[board]}</th>
              <td>
                <ul className="board-cap-list">
                  {CAPS_FOR_BOARD(board).map((capability) => {
                    const granted = boardHasCapability(snapshot, role, board, capability);
                    const editable = mode === 'edit';
                    return (
                      <li key={capability}>
                        <button
                          type="button"
                          className={`board-cap-toggle${granted ? ' is-on' : ''}`}
                          aria-pressed={granted}
                          disabled={!editable}
                          title={BOARD_CAPABILITY_LABELS[capability]}
                          onClick={() => onToggleCapability(board, capability)}
                        >
                          {BOARD_CAPABILITY_LABELS[capability]}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (embedded) {
    return table;
  }

  return (
    <section id="board-permissions" className="rbac-board-role">
      <header className="rbac-role-permissions__group-head">
        <h2>Board permissions</h2>
        <p className="meta">Kanban lane capabilities for Intake → Development → QA → Release → Done.</p>
      </header>
      {table}
    </section>
  );
}
