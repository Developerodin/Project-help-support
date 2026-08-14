'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
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
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(Boolean(token));

  useEffect(() => {
    if (!token) return undefined;

    let cancelled = false;
    setPreviewBusy(true);
    setError(null);

    apiFetch('/auth/invite/preview', { method: 'POST', body: { token } })
      .then((result) => {
        if (!cancelled) setEmail(result.email || '');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err?.code === 'INVALID_INVITE' || err?.status === 400) {
          setExpired(true);
          return;
        }
        setError(err);
      })
      .finally(() => {
        if (!cancelled) setPreviewBusy(false);
      });

    return () => { cancelled = true; };
  }, [token]);

  const checks = useMemo(() => passwordChecks(password, email), [password, email]);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    if (password !== password2) {
      setError({ message: 'The two passwords do not match.' });
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/auth/invite/accept', { method: 'POST', body: { token, name, password } });
      router.push('/login');
    } catch (err) {
      if (err?.code === 'INVALID_INVITE' || err?.status === 400) {
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

  if (previewBusy) {
    return (
      <AuthFrame>
        <AuthBrand />
        <p className="meta">Loading invite…</p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <AuthBrand />
      <form className="form" onSubmit={onSubmit}>
        <h1 id="heading">Join your workspace</h1>
        <p className="sub">Set your name and password to accept the invite.</p>

        <AuthField
          icon="at"
          id="invite-email"
          label="Email"
          type="email"
          value={email}
          readOnly
          onChange={() => {}}
        />

        <AuthField
          id="invite-name"
          label="Name"
          type="text"
          autoComplete="name"
          placeholder="Your name"
          required
          minLength={1}
          bad={Boolean(error)}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

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
    <Suspense fallback={<p className="meta">Loading…</p>}>
      <AcceptInviteForm />
    </Suspense>
  );
}
