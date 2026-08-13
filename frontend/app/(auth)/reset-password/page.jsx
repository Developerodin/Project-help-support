'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/shared/api/client.js';
import AuthFrame, { AuthBrand } from '@/shared/components/auth/auth-shell.jsx';
import AuthField from '@/shared/components/auth/auth-field.jsx';
import AuthError from '@/shared/components/auth/auth-error.jsx';

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    if (password !== password2) {
      setError({ message: 'The two passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/auth/reset-password', { method: 'POST', body: { token, password } });
      router.push('/login');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthFrame view="expired">
        <form className="form" onSubmit={(e) => { e.preventDefault(); router.push('/forgot-password'); }}>
          <AuthBrand />
          <p id="heading">This link has expired</p>
          <p className="sub">Invite links last 72 hours, reset links last one. This one is missing its token.</p>
          <AuthError tone="muted">
            Nothing is wrong with your account. An expired link is the system working: a link that lived forever in an inbox would be a permanent way in.
          </AuthError>
          <div className="btn-row solo">
            <button className="button1" type="submit">Ask for a new link</button>
          </div>
          <Link className="button3" href="/login" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Back to sign in
          </Link>
        </form>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame view="reset">
      <form className="form" onSubmit={onSubmit}>
        <AuthBrand />
        <p id="heading">Reset your password</p>
        <p className="sub">Choose a new password. Using this link signs out every other session.</p>

        <AuthField
          icon="lock"
          id="new-password"
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          peek
          bad={Boolean(error)}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <AuthField
          icon="lock"
          id="new-password2"
          label="Password again"
          type="password"
          autoComplete="new-password"
          required
          peek
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
        />

        <AuthError error={error} />

        <div className="btn-row solo">
          <button className="button1" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Set new password'}
          </button>
        </div>
        <Link className="button3" href="/login" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          Back to sign in
        </Link>
      </form>
    </AuthFrame>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="auth"><p className="sub">Loading…</p></div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
