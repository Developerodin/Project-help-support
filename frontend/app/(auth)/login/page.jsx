'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import FormError from '@/shared/components/form-error.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      router.push('/tickets');
    } catch (err) {
      // The server returns ONE message for "no such email" and "wrong
      // password"; showing it verbatim is what keeps that true in the UI.
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>Sign in</h1>

      <label htmlFor="email">Email</label>
      <input
        id="email" type="email" autoComplete="username" required
        value={email} onChange={(e) => setEmail(e.target.value)}
        style={{ width: '100%', padding: 8, marginBottom: 12 }}
      />

      <label htmlFor="password">Password</label>
      <input
        id="password" type="password" autoComplete="current-password" required
        value={password} onChange={(e) => setPassword(e.target.value)}
        style={{ width: '100%', padding: 8, marginBottom: 12 }}
      />

      <FormError error={error} />

      <button type="submit" disabled={busy} style={{ width: '100%', padding: 10 }}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
