'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/shared/api/client.js';
import AuthFrame, { AuthBrand } from '@/shared/components/auth/auth-shell.jsx';
import AuthField from '@/shared/components/auth/auth-field.jsx';
import AuthError from '@/shared/components/auth/auth-error.jsx';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiFetch('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <AuthFrame view="sent">
        <form className="form" onSubmit={(e) => { e.preventDefault(); setSent(false); }}>
          <AuthBrand />
          <p id="heading">Check your mail</p>
          <p className="sub">If that address has an account, a reset link is on its way to it.</p>
          <AuthError tone="muted">
            The wording is conditional on purpose. Confirming that an address does or does not have an account would let anyone test addresses one at a time to find out who works here.
          </AuthError>
          <div className="btn-row solo">
            <button className="button1" type="submit">Send it again</button>
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
        <p className="sub">We send a link to the address on your account. It works once and lasts an hour.</p>

        <AuthField
          icon="at"
          id="reset-email"
          label="Email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <AuthError error={error} />

        <div className="btn-row solo">
          <button className="button1" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send the link'}
          </button>
        </div>
        <Link className="button3" href="/login" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          Back to sign in
        </Link>
      </form>
    </AuthFrame>
  );
}
