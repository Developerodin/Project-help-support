'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  NOTIFICATION_EVENTS,
  DEFAULT_NOTIFICATION_PREFS,
  notificationEventLabel,
} from '@pms/shared';
import { resetNotificationPrefs, updateNotificationPrefs } from '@/shared/api/users.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import ConfirmDialog from '@/shared/components/confirm-dialog.jsx';
import FormError from '@/shared/components/form-error.jsx';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { mutateNotifications } from '@/shared/lib/notification-swr.js';
import { showToast } from '@/shared/lib/toast.js';

const HIGH_IMPACT_EVENTS = new Set([
  'TICKET_CREATED',
  'TICKET_ASSIGNED',
  'TICKET_STAGE_CHANGED',
  'TICKET_REOPENED',
  'TICKET_CLOSED',
  'TICKET_MENTIONED',
]);

function buildPrefs(user) {
  return {
    email: { ...DEFAULT_NOTIFICATION_PREFS.email, ...(user?.notificationPrefs?.email || {}) },
    inApp: { ...DEFAULT_NOTIFICATION_PREFS.inApp, ...(user?.notificationPrefs?.inApp || {}) },
  };
}

function channelLabel(channel) {
  return channel === 'inApp' ? 'in-app' : 'email';
}

function wouldDisableAllChannels(prefs, channel, event, enabled) {
  if (enabled) return false;
  const otherChannel = channel === 'inApp' ? 'email' : 'inApp';
  return !prefs[otherChannel][event];
}

function toggleNeedsConfirm(prefs, channel, event, enabled) {
  if (enabled) return false;
  if (wouldDisableAllChannels(prefs, channel, event, enabled)) return true;
  return HIGH_IMPACT_EVENTS.has(event);
}

export default function NotificationSettingsPage() {
  const { user, refreshUser } = useAuth();
  const [prefs, setPrefs] = useState(() => buildPrefs(user));
  const [error, setError] = useState(null);
  const [pendingToggle, setPendingToggle] = useState(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    setPrefs(buildPrefs(user));
  }, [user]);

  const applyToggle = useCallback(async (channel, event, enabled) => {
    setSaveBusy(true);
    setError(null);
    try {
      const updated = await updateNotificationPrefs({ [channel]: { [event]: enabled } });
      await refreshUser(updated);
      setPrefs(buildPrefs(updated));
      await mutateNotifications();
      showToast(`${enabled ? 'Enabled' : 'Disabled'} ${channelLabel(channel)} for ${notificationEventLabel(event)}`);
    } catch (err) {
      setError(err);
      showToast(normalizeApiError(err)?.message || 'Could not save preference');
    } finally {
      setSaveBusy(false);
    }
  }, [refreshUser]);

  function requestToggle(channel, event) {
    const enabled = !prefs[channel][event];
    if (toggleNeedsConfirm(prefs, channel, event, enabled)) {
      setPendingToggle({ channel, event, enabled });
      return;
    }
    applyToggle(channel, event, enabled);
  }

  async function confirmToggle() {
    if (!pendingToggle) return;
    const { channel, event, enabled } = pendingToggle;
    setPendingToggle(null);
    await applyToggle(channel, event, enabled);
  }

  async function handleRestoreDefaults() {
    setResetBusy(true);
    setError(null);
    try {
      const updated = await resetNotificationPrefs();
      await refreshUser(updated);
      setPrefs(buildPrefs(updated));
      await mutateNotifications();
      showToast('Notification preferences restored to defaults');
    } catch (err) {
      setError(err);
      showToast(normalizeApiError(err)?.message || 'Could not restore defaults');
    } finally {
      setResetBusy(false);
    }
  }

  const busy = saveBusy || resetBusy;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notification preferences</h1>
          <p className="sub">Choose which events reach you by email and in the app.</p>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={handleRestoreDefaults}
          disabled={busy}
        >
          Restore defaults
        </button>
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
                    disabled={busy}
                    onChange={() => requestToggle('inApp', event)}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${notificationEventLabel(event)} email`}
                    checked={prefs.email[event]}
                    disabled={busy}
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
