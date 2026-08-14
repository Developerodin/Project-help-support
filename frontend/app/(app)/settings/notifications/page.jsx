'use client';

import { useEffect, useState } from 'react';
import {
  NOTIFICATION_EVENTS,
  DEFAULT_NOTIFICATION_PREFS,
  notificationEventLabel,
} from '@pms/shared';
import { updateNotificationPrefs } from '@/shared/api/users.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import ConfirmDialog from '@/shared/components/confirm-dialog.jsx';
import FormError from '@/shared/components/form-error.jsx';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { showToast } from '@/shared/lib/toast.js';

function buildPrefs(user) {
  return {
    email: { ...DEFAULT_NOTIFICATION_PREFS.email, ...(user?.notificationPrefs?.email || {}) },
    inApp: { ...DEFAULT_NOTIFICATION_PREFS.inApp, ...(user?.notificationPrefs?.inApp || {}) },
  };
}

function channelLabel(channel) {
  return channel === 'inApp' ? 'in-app' : 'email';
}

export default function NotificationSettingsPage() {
  const { user, refreshUser } = useAuth();
  const [prefs, setPrefs] = useState(() => buildPrefs(user));
  const [error, setError] = useState(null);
  const [pendingToggle, setPendingToggle] = useState(null);
  const [saveBusy, setSaveBusy] = useState(false);

  useEffect(() => {
    setPrefs(buildPrefs(user));
  }, [user]);

  function requestToggle(channel, event) {
    setPendingToggle({ channel, event, enabled: !prefs[channel][event] });
  }

  async function confirmToggle() {
    if (!pendingToggle) return;
    const { channel, event, enabled } = pendingToggle;
    setSaveBusy(true);
    setError(null);
    try {
      const updated = await updateNotificationPrefs({ [channel]: { [event]: enabled } });
      await refreshUser(updated);
      setPrefs(buildPrefs(updated));
      showToast(`${enabled ? 'Enabled' : 'Disabled'} ${channelLabel(channel)} for ${notificationEventLabel(event)}`);
      setPendingToggle(null);
    } catch (err) {
      setError(err);
      showToast(normalizeApiError(err)?.message || 'Could not save preference');
    } finally {
      setSaveBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notification preferences</h1>
          <p className="sub">Choose which events reach you by email and in the app.</p>
        </div>
      </div>
      <FormError error={error} />

      <div className="tablewrap notif-prefs">
        <table>
          <thead>
            <tr><th>Event</th><th>In app</th><th>Email</th></tr>
          </thead>
          <tbody>
            {NOTIFICATION_EVENTS.map((event) => (
              <tr key={event}>
                <td>{notificationEventLabel(event)}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${notificationEventLabel(event)} in app`}
                    checked={prefs.inApp[event]}
                    disabled={saveBusy}
                    onChange={() => requestToggle('inApp', event)}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${notificationEventLabel(event)} email`}
                    checked={prefs.email[event]}
                    disabled={saveBusy}
                    onChange={() => requestToggle('email', event)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(pendingToggle)}
        title={pendingToggle?.enabled ? 'Enable notification?' : 'Disable notification?'}
        message={
          pendingToggle
            ? `${pendingToggle.enabled ? 'Enable' : 'Disable'} ${channelLabel(pendingToggle.channel)} notifications for ${notificationEventLabel(pendingToggle.event)}?`
            : ''
        }
        confirmLabel={pendingToggle?.enabled ? 'Enable' : 'Disable'}
        cancelLabel="Cancel"
        busy={saveBusy}
        onConfirm={confirmToggle}
        onCancel={() => {
          if (!saveBusy) setPendingToggle(null);
        }}
      />
    </>
  );
}
