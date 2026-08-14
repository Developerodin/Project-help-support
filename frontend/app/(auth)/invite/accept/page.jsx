'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '@/shared/api/client.js';
import AuthFrame, { AuthBrand } from '@/shared/components/auth/auth-shell.jsx';
import AuthField from '@/shared/components/auth/auth-field.jsx';
import AuthError from '@/shared/components/auth/auth-error.jsx';

function passwordChecks(password, email) {
  const lower = (password || '').toLowerCase();
  const emailLocal = (email || '').split('@')[0]?.toLowerCase() || '';
  return {
    length: password.length >= 12,
    complexity: /[0-9!@#$%^&*_.-]/.test(password),
    notEmail: password.length > 0 && (!emailLocal || !lower.includes(emailLocal)),
  };
}

function AcceptInviteForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') || '';
  const emailHint = params.get('email') || '';
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  const checks = useMemo(() => passwordChecks(password, emailHint), [password, emailHint]);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    if (password !== password2) {
      setError({ message: 'The two passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/auth/invite/accept', { method: 'POST', body: { token, password } });
      router.push('/login');
    } catch (err) {
      if (err?.code === 'INVALID_TOKEN' || err?.status === 400) {
        const msg = String(err?.message || '').toLowerCase();
        if (msg.includes('expir') || msg.includes('invalid') || msg.includes('token')) {
          setExpired(true);
        }
      }
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <AuthFrame>
        <AuthBrand />
        <form className="form" onSubmit={(e) => e.preventDefault()}>
          <h1 id="heading">This link has expired</h1>
          <p className="sub">Invite links last 72 hours, reset links last one. This one is missing its token.</p>
          <AuthError tone="muted">
            Nothing is wrong with your account. An expired link is the system working: a link that lived forever in an inbox would be a permanent way in.
          </AuthError>
          <div className="btn-row solo">
            <button className="button1" type="button" onClick={() => router.push('/login')}>
              Back to sign in
            </button>
          </div>
        </form>
      </AuthFrame>
    );
  }

  if (expired) {
    return (
      <AuthFrame>
        <AuthBrand />
        <form className="form" onSubmit={(e) => { e.preventDefault(); router.push('/login'); }}>
          <h1 id="heading">This link has expired</h1>
          <p className="sub">Invite links last 72 hours, reset links last one. Ask an admin for a new invite.</p>
          <AuthError tone="muted">
            Nothing is wrong with your account. An expired link is the system working: a link that lived forever in an inbox would be a permanent way in.
          </AuthError>
          <div className="btn-row solo">
            <button className="button1" type="submit">Ask for a new link</button>
          </div>
          <button className="button3" type="button" onClick={() => router.push('/login')}>
            Back to sign in
          </button>
        </form>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <AuthBrand />
      <form className="form" onSubmit={onSubmit}>
        <h1 id="heading">Set your password</h1>
        <p className="sub">Setting a password is what accepts the invite.</p>

        {emailHint ? (
          <AuthField
            icon="at"
            id="invite-email"
            label="Email"
            type="email"
            value={emailHint}
            readOnly
            onChange={() => {}}
          />
        ) : null}

        <AuthField
          icon="lock"
          id="invite-password"
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="Choose a password"
          required
          minLength={12}
          peek
          bad={Boolean(error)}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ul className="reqs" id="pwreqs">
          <li className={checks.length ? 'met' : undefined}><i />At least 12 characters</li>
          <li className={checks.complexity ? 'met' : undefined}><i />A number or a symbol</li>
          <li className={checks.notEmail ? 'met' : undefined}><i />Not your email address</li>
        </ul>
        <AuthField
          icon="lock"
          id="invite-password2"
          label="Password again"
          type="password"
          autoComplete="new-password"
          placeholder="Enter it again"
          required
          peek
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
        />

        <AuthError error={error} />

        <div className="btn-row solo">
          <button className="button1" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Accept and sign in'}
          </button>
        </div>
        <button className="button3" type="button" onClick={() => setExpired(true)}>
          This link looks wrong
        </button>
      </form>
    </AuthFrame>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={(
      <AuthFrame>
        <div className="form"><p className="sub">Loading…</p></div>
      </AuthFrame>
    )}>
      <AcceptInviteForm />
    </Suspense>
  );
}
