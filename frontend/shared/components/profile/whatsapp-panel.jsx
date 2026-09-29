'use client';

import { useCallback, useEffect, useState } from 'react';
import { getWhatsappLink, startWhatsappLink, unlinkWhatsapp } from '@/shared/api/whatsapp.js';
import FormError from '@/shared/components/form-error.jsx';
import { formatWhen } from '@/shared/components/tickets/ticket-drawer-utils.js';

/**
 * Link this account to a WhatsApp number: the app shows a one-time code and the
 * user sends it from their phone, which proves they hold both.
 * Hidden when WhatsApp isn't set up or the assistant is off for this user.
 */
export default function WhatsappPanel() {
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getWhatsappLink();
      setStatus(next);
      if (next.linked) setPending(null);
    } catch {
      setStatus({ enabled: false });
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const run = async (work) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!status?.enabled) return null;

  const message = pending ? `LINK ${pending.code}` : '';
  // whatsapp:// opens the installed app directly (phone or desktop); wa.me would stop at a web page on desktop.
  const waQuery = pending?.businessNumber ? `phone=${pending.businessNumber}&text=${encodeURIComponent(message)}` : null;
  const waUrl = waQuery ? `whatsapp://send?${waQuery}` : null;
  const waWebUrl = waQuery ? `https://web.whatsapp.com/send?${waQuery}` : null;

  return (
    <section className="panel profile-panel" aria-labelledby="profile-whatsapp">
      <header className="profile-panel__head">
        <h2 id="profile-whatsapp">WhatsApp</h2>
        <p>Ask the assistant about your tickets and projects from WhatsApp, or file a new ticket. Other changes are made here in the app.</p>
      </header>
      <div className="profile-panel__body">
        <FormError error={error} />
        {status.linked ? (
          <div className="profile-setting">
            <div className="profile-setting__info">
              <strong>Linked to {status.number}</strong>
              <p>Since {formatWhen(status.linkedAt)}</p>
            </div>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(async () => { await unlinkWhatsapp(); await refresh(); })}>
              Unlink
            </button>
          </div>
        ) : pending ? (
          <div className="profile-setting">
            <div className="profile-setting__info">
              <strong>Send this message on WhatsApp</strong>
              <p><code>{message}</code></p>
              <p className="help">
                {pending.businessNumber ? `To +${pending.businessNumber}. ` : ''}
                The code works once and expires at {formatWhen(pending.expiresAt)}.
                {waWebUrl ? <> No WhatsApp app here? <a href={waWebUrl} target="_blank" rel="noreferrer">Use WhatsApp Web</a>.</> : null}
              </p>
            </div>
            {waUrl ? (
              <a className="btn btn-sm btn-primary" href={waUrl}>Open WhatsApp</a>
            ) : null}
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(refresh)}>
              I&apos;ve sent it
            </button>
          </div>
        ) : (
          <div className="profile-setting">
            <div className="profile-setting__info">
              <strong>Not linked</strong>
              <p>Get a code, then send it from the phone you want to use.</p>
            </div>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => run(async () => setPending(await startWhatsappLink()))}>
              Link WhatsApp
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
