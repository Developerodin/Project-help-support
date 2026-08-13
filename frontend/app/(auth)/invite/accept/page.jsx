'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/shared/api/client.js';
import FormError from '@/shared/components/form-error.jsx';

function AcceptInviteForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch('/auth/invite/accept', { method: 'POST', body: { token, password } });
      router.push('/login');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <p>This invitation link is missing its token.</p>;

  return (
    <form onSubmit={onSubmit}>
      <h1>Set your password</h1>

      <label htmlFor="password">New password</label>
      <input
        id="password" type="password" autoComplete="new-password" minLength={8} required
        value={password} onChange={(e) => setPassword(e.target.value)}
        style={{ width: '100%', padding: 8, marginBottom: 12 }}
      />

      <FormError error={error} />

      <button type="submit" disabled={busy} style={{ width: '100%', padding: 10 }}>
        {busy ? 'Saving…' : 'Set password'}
      </button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <AcceptInviteForm />
    </Suspense>
  );
}
