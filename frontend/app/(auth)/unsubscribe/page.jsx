'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  getUnsubscribeStatus,
  resubscribeEmail,
  unsubscribeEmail,
} from '@/shared/api/notifications.js';
import AuthFrame, { AuthBrand } from '@/shared/components/auth/auth-shell.jsx';
import AuthError from '@/shared/components/auth/auth-error.jsx';

const isBadLink = (err) => err?.status >= 400 && err?.status < 500;

/*
 * Opened from an email, signed in or not. Loading the page only reads the
 * link's status: mail scanners fetch links before people do, so the change
 * waits for a button press.
 */
function UnsubscribeForm() {
  const token = useSearchParams().get('token') || '';
  const [status, setStatus] = useState(null);
  const [badLink, setBadLink] = useState(!token);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    getUnsubscribeStatus(token)
      .then((result) => { if (!cancelled) setStatus(result); })
      .catch((err) => {
        if (cancelled) return;
        if (isBadLink(err)) setBadLink(true);
        else setError(err);
      });
    return () => { cancelled = true; };
  }, [token]);

  async function change(paused) {
    setBusy(true);
    setError(null);
    try {
      await (paused ? unsubscribeEmail(token) : resubscribeEmail(token));
      setStatus((prev) => ({ ...prev, paused }));
    } catch (err) {
      if (isBadLink(err)) setBadLink(true);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (badLink) {
    return (
      <AuthFrame>
        <AuthBrand />
        <div className="form">
          <h1 id="heading">This link doesn&apos;t work</h1>
          <p className="sub">
            It may be incomplete or out of date. You can change which emails you get in your notification settings.
          </p>
          <Link className="button3" href="/settings/notifications">Manage notification settings</Link>
        </div>
      </AuthFrame>
    );
  }

  if (!status) {
    return (
      <AuthFrame>
        <AuthBrand />
        <div className="form">
          {error ? (
            <>
              <h1 id="heading">Something went wrong</h1>
              <AuthError error={error} />
            </>
          ) : <p className="meta" role="status">Loading…</p>}
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <AuthBrand />
      <div className="form">
        {status.paused ? (
          <>
            <h1 id="heading">You&apos;re unsubscribed</h1>
            <p className="sub" role="status">
              You&apos;re unsubscribed from ticket email for {status.email}. Invites and password resets still arrive.
            </p>
          </>
        ) : (
          <>
            <h1 id="heading">Unsubscribe from ticket email?</h1>
            <p className="sub">
              {status.email} will stop getting email about tickets. Invites and password resets still arrive.
            </p>
          </>
        )}
        <AuthError error={error} />
        <div className="btn-row solo">
          <button className="button1" type="button" disabled={busy} onClick={() => change(!status.paused)}>
            {status.paused ? 'Resubscribe' : 'Unsubscribe'}
          </button>
        </div>
        <Link className="button3" href="/settings/notifications">Manage notification settings</Link>
      </div>
    </AuthFrame>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<p className="meta">Loading…</p>}>
      <UnsubscribeForm />
    </Suspense>
  );
}
