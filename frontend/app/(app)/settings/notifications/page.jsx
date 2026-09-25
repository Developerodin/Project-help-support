'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  NOTIFICATION_EVENTS,
  DEFAULT_NOTIFICATION_PREFS,
  notificationEventLabel,
} from '@pms/shared';
import { resetNotificationPrefs, updateNotificationPrefs } from '@/shared/api/users.js';
import { getPushConfig } from '@/shared/api/notifications.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import ConfirmDialog from '@/shared/components/confirm-dialog.jsx';
import FormError from '@/shared/components/form-error.jsx';
import { normalizeApiError } from '@/shared/lib/api-error.js';
import { mutateNotifications } from '@/shared/lib/notification-swr.js';
import { disablePush, enablePush, pushStatus } from '@/shared/lib/push.js';
import { showToast } from '@/shared/lib/toast.js';

function buildPrefs(user) {
  return {
    email: { ...DEFAULT_NOTIFICATION_PREFS.email, ...(user?.notificationPrefs?.email || {}) },
    inApp: { ...DEFAULT_NOTIFICATION_PREFS.inApp, ...(user?.notificationPrefs?.inApp || {}) },
  };
}

/** Only turning off an event's last channel asks first: after that, it reaches you nowhere. */
function wouldDisableAllChannels(prefs, channel, event, enabled) {
  if (enabled) return false;
  const otherChannel = channel === 'inApp' ? 'email' : 'inApp';
  return !prefs[otherChannel][event];
}

const PUSH_STATUS_TEXT = {
  unsupported: "This browser can't receive push notifications.",
  'needs-install': 'On iPhone and iPad, push works only in the Home Screen app. In Safari tap Share → Add to Home Screen, open the app from there, and turn push on.',
  'no-worker': "Push isn't available in this browser session. Reload the page, or open the installed app.",
  denied: 'Notifications are blocked for this site. Allow them in your browser or system settings, then reload this page.',
  off: 'Get a notification on this device when something in your in-app list happens, even with the app closed.',
  on: 'On for this device. It follows your In app choices below.',
};

/** Push is per device, so it's a switch for this browser rather than a column in the table. */
function PushDeviceSetting() {
  const { impersonation } = useAuth();
  const [serverEnabled, setServerEnabled] = useState(false);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPushConfig().catch(() => null), pushStatus()]).then(([config, current]) => {
      if (cancelled) return;
      setServerEnabled(Boolean(config?.enabled));
      setStatus(current);
    });
    return () => { cancelled = true; };
  }, []);

  if (!serverEnabled || !status) return null;

  async function toggle() {
    setBusy(true);
    try {
      if (status === 'on') {
        await disablePush();
        showToast('Push turned off for this device');
      } else {
        await enablePush();
        showToast('Push turned on for this device');
      }
    } catch (err) {
      showToast(normalizeApiError(err)?.message || err?.message || 'Could not change push', { type: 'error' });
    } finally {
      setStatus(await pushStatus());
      setBusy(false);
    }
  }

  const canToggle = (status === 'on' || status === 'off') && !impersonation;

  return (
    <div className="page-head">
      <div>
        <h2>Push on this device</h2>
        <p className="sub">
          {impersonation ? "Push can't be changed while impersonating." : PUSH_STATUS_TEXT[status]}
        </p>
      </div>
      {canToggle ? (
        <button type="button" className="btn btn-sm" onClick={toggle} disabled={busy}>
          {status === 'on' ? 'Turn off' : 'Turn on'}
        </button>
      ) : null}
    </div>
  );
}

export default function NotificationSettingsPage() {
  const { user, refreshUser } = useAuth();
  const [prefs, setPrefs] = useState(() => buildPrefs(user));
  const [error, setError] = useState(null);
  const [pendingToggle, setPendingToggle] = useState(null);
  // Only the checkbox being saved locks; the rest of the table stays usable.
  const [savingKeys, setSavingKeys] = useState(() => new Set());
  const [resetBusy, setResetBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    setPrefs(buildPrefs(user));
  }, [user]);

  /*
   * Saves on different rows can overlap. Each response is the whole prefs
   * object, so one that lands out of order can briefly show another row's old
   * value until its own response arrives; the server has both either way.
   */
  const applyToggle = useCallback(async (channel, event, enabled) => {
    const key = `${channel}:${event}`;
    setSavingKeys((prev) => new Set(prev).add(key));
    setError(null);
    setSaveStatus('Saving…');
    try {
      const updated = await updateNotificationPrefs({ [channel]: { [event]: enabled } });
      await refreshUser(updated);
      setPrefs(buildPrefs(updated));
      await mutateNotifications();
      setSaveStatus('Saved');
    } catch (err) {
      setError(err);
      setSaveStatus('');
      showToast(normalizeApiError(err)?.message || 'Could not save preference', { type: 'error' });
    } finally {
      setSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, [refreshUser]);

  function requestToggle(channel, event) {
    const enabled = !prefs[channel][event];
    if (wouldDisableAllChannels(prefs, channel, event, enabled)) {
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
    setSaveStatus('Saving…');
    try {
      const updated = await resetNotificationPrefs();
      await refreshUser(updated);
      setPrefs(buildPrefs(updated));
      await mutateNotifications();
      setSaveStatus('Defaults restored');
    } catch (err) {
      setError(err);
      setSaveStatus('');
      showToast(normalizeApiError(err)?.message || 'Could not restore defaults', { type: 'error' });
    } finally {
      setResetBusy(false);
    }
  }

  const checkboxDisabled = (channel, event) => resetBusy || savingKeys.has(`${channel}:${event}`);

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
          disabled={resetBusy || savingKeys.size > 0}
        >
          Restore defaults
        </button>
        <span className="meta" role="status" aria-live="polite">{saveStatus}</span>
      </div>
      <FormError error={error} />
      <PushDeviceSetting />

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
                    disabled={checkboxDisabled('inApp', event)}
                    onChange={() => requestToggle('inApp', event)}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${notificationEventLabel(event)} email`}
                    checked={prefs.email[event]}
                    disabled={checkboxDisabled('email', event)}
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
        title="Turn off the last channel?"
        message={
          pendingToggle
            ? `"${notificationEventLabel(pendingToggle.event)}" will no longer reach you in the app or by email.`
            : ''
        }
        confirmLabel="Turn off"
        cancelLabel="Cancel"
        onConfirm={confirmToggle}
        onCancel={() => setPendingToggle(null)}
      />
    </>
  );
}
