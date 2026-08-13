'use client';

import { useCallback, useEffect, useState } from 'react';
import { ROLES } from '@pms/shared';
import { listUsers, inviteUser, patchUser, resendInvite } from '@/shared/api/users.js';
import FormError from '@/shared/components/form-error.jsx';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [draft, setDraft] = useState({ name: '', email: '', role: 'member' });
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    listUsers().then((page) => setUsers(page.results)).catch(setError);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function invite(event) {
    event.preventDefault();
    setError(null);
    try {
      await inviteUser(draft);
      setDraft({ name: '', email: '', role: 'member' });
      reload();
    } catch (err) {
      setError(err);
    }
  }

  const update = async (id, body) => {
    setError(null);
    try {
      await patchUser(id, body);
      reload();
    } catch (err) { setError(err); }
  };

  return (
    <>
      <h1>Users</h1>
      <FormError error={error} />

      <form onSubmit={invite} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <label htmlFor="invite-name">Name</label>
        <input id="invite-name" required value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />

        <label htmlFor="invite-email">Email</label>
        <input id="invite-email" type="email" required value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })} />

        <label htmlFor="invite-role">Role</label>
        <select id="invite-role" value={draft.role}
          onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
          {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>

        <button type="submit">Send invite</button>
      </form>

      <table style={{ width: '100%' }}>
        <thead>
          <tr>{['Name', 'Email', 'Role', 'Status', ''].map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>
                <select
                  aria-label={`Role for ${user.name}`}
                  value={user.role}
                  onChange={(e) => update(user.id, { role: e.target.value })}
                >
                  {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </td>
              <td>{user.status}</td>
              <td>
                {/* NO hard delete — deleting a user breaks createdBy on every
                    ticket they ever filed. */}
                {user.status === 'active' && (
                  <button type="button" onClick={() => update(user.id, { status: 'inactive' })}>
                    Deactivate
                  </button>
                )}
                {user.status === 'inactive' && (
                  <button type="button" onClick={() => update(user.id, { status: 'active' })}>
                    Reactivate
                  </button>
                )}
                {user.status === 'invited' && (
                  <button type="button" onClick={() => resendInvite(user.id)}>Resend invitation</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
