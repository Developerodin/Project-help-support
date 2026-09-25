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

const PUSH_STATUS_TEXT = {
  unsupported: "This browser can't receive push notifications.",
  'needs-install': 'On iPhone and iPad, push works only in the Home Screen app. In Safari tap Share → Add to Home Screen, open the app from there, and turn push on.',
  'no-worker': 'Push is available in the installed app and the production site.',
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
      showToast(normalizeApiError(err)?.message || err?.message || 'Could not change push');
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
