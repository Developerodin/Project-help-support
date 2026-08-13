'use client';

import { useCallback, useEffect, useState } from 'react';
import { ROLES } from '@pms/shared';
import { listUsers, inviteUser, patchUser, resendInvite } from '@/shared/api/users.js';
import FormError from '@/shared/components/form-error.jsx';
import { initials } from '@/shared/components/icons.jsx';

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
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p className="sub">Invite someone, set their role, deactivate without deleting history.</p>
        </div>
      </div>
      <FormError error={error} />

      <form className="toolbar" onSubmit={invite}>
        <label htmlFor="invite-name">Name</label>
        <input id="invite-name" required placeholder="Name" value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <label htmlFor="invite-email">Email</label>
        <input id="invite-email" type="email" required placeholder="name@company.com" value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
        <label htmlFor="invite-role">Role</label>
        <select id="invite-role" value={draft.role}
          onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
          {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
        </select>
        <button type="submit" className="btn btn-primary">Send invite</button>
      </form>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Person</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <span className="personcell">
                    <span className="avatar sm">{initials(user.name)}</span>
                    <span>{user.name}</span>
                  </span>
                </td>
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
                <td><span className="chip">{user.status}</span></td>
                <td>
                  {user.status === 'active' && (
                    <button type="button" className="btn btn-sm" onClick={() => update(user.id, { status: 'inactive' })}>
                      Deactivate
                    </button>
                  )}
                  {user.status === 'inactive' && (
                    <button type="button" className="btn btn-sm" onClick={() => update(user.id, { status: 'active' })}>
                      Reactivate
                    </button>
                  )}
                  {user.status === 'invited' && (
                    <button type="button" className="btn btn-sm" onClick={() => resendInvite(user.id)}>Resend</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
