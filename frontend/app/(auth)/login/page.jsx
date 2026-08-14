'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import AuthFrame, { AuthBrand } from '@/shared/components/auth/auth-shell.jsx';
import AuthField from '@/shared/components/auth/auth-field.jsx';
import AuthError from '@/shared/components/auth/auth-error.jsx';

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
    <AuthFrame>
      <AuthBrand />
      <form className="form" onSubmit={onSubmit}>
        <h1 id="heading">Sign in</h1>
        <p className="sub">Sign in to continue to your workspace.</p>

        <AuthField
          icon="at"
          id="email"
          label="Email"
          type="email"
          autoComplete="username"
          placeholder="Enter your email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <AuthField
          icon="lock"
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          required
          peek
          bad={Boolean(error)}
          describedBy={error ? 'aperr' : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <AuthError error={error} />

        <div className="btn-row solo">
          <button className="button1" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        <button className="button3" type="button" onClick={() => router.push('/forgot-password')}>
          Forgot password
        </button>
      </form>
    </AuthFrame>
  );
}
