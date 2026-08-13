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
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-form">
        <div className="brand" style={{ border: 'none', height: 'auto', padding: '0 0 16px' }}>
          <span className="mark" aria-hidden="true"><span /><span /><span /></span>
          <b>Help &amp; Support</b>
        </div>
        <p id="heading">Sign in</p>
        <p className="sub">Use the account you were invited with.</p>

        <form onSubmit={onSubmit}>
          <label className="lbl" htmlFor="email">Email</label>
          <input
            className="input-field"
            id="email" type="email" autoComplete="username" required
            value={email} onChange={(e) => setEmail(e.target.value)}
          />

          <label className="lbl" htmlFor="password">Password</label>
          <input
            className="input-field"
            id="password" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)}
          />

          <FormError error={error} />

          <button type="submit" className="btn btn-primary" disabled={busy} style={{ width: '100%', marginTop: 12 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
