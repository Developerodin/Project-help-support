'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

const DEFAULT_QUIET_HOURS = { enabled: false, start: '22:00', end: '08:00', allowUrgent: true };

function detectedTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Accounts from before these settings existed have no such keys: read them as the defaults. */
function buildPrefs(user) {
  const stored = user?.notificationPrefs || {};
  return {
    email: { ...DEFAULT_NOTIFICATION_PREFS.email, ...(stored.email || {}) },
    inApp: { ...DEFAULT_NOTIFICATION_PREFS.inApp, ...(stored.inApp || {}) },
    emailFrequency: stored.emailFrequency || 'immediate',
    timeZone: stored.timeZone || detectedTimeZone(),
    quietHours: { ...DEFAULT_QUIET_HOURS, ...(stored.quietHours || {}) },
    emailPaused: Boolean(stored.emailPaused),
  };
}

function timeZoneOptions(current) {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

const eventMap = (isOn) => Object.fromEntries(NOTIFICATION_EVENTS.map((event) => [event, isOn(event)]));
const only = (...events) => eventMap((event) => events.includes(event));

// One click sets every row; turning channels off here is the point, so no confirm.
const PRESETS = [
  {
    id: 'mine',
    label: "Only what's for me",
    prefs: { email: only('TICKET_MENTIONED', 'TICKET_ASSIGNED'), inApp: eventMap(() => true) },
  },
  { id: 'everything', label: 'Everything', prefs: { email: eventMap(() => true), inApp: eventMap(() => true) } },
  {
    id: 'quiet',
    label: 'Quiet',
    prefs: {
      email: only('TICKET_MENTIONED'),
      inApp: only('TICKET_MENTIONED', 'TICKET_ASSIGNED', 'TICKET_COMMENTED'),
    },
  },
];

function matchesPreset(prefs, preset) {
  return NOTIFICATION_EVENTS.every((event) => prefs.email[event] === preset.prefs.email[event]
    && prefs.inApp[event] === preset.prefs.inApp[event]);
}

const FREQUENCY_OPTIONS = [
  { value: 'immediate', label: 'Right away (grouped per ticket)' },
  { value: 'hourly', label: 'Hourly summary' },
  { value: 'daily', label: 'Daily summary at 9:00' },
];

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
  // Only the control being saved locks; the rest of the page stays usable.
  const [savingKeys, setSavingKeys] = useState(() => new Set());
  const [resetBusy, setResetBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    setPrefs(buildPrefs(user));
  }, [user]);

  const zones = useMemo(() => timeZoneOptions(prefs.timeZone), [prefs.timeZone]);
  const activePreset = PRESETS.find((preset) => matchesPreset(prefs, preset))?.id ?? null;

  /*
   * Saves on different controls can overlap. Each response is the whole prefs
   * object, so one that lands out of order can briefly show another control's
   * old value until its own response arrives; the server has both either way.
   *
   * `optimistic` shows the new value while saving and puts the old one back
   * if the save fails; without it the control keeps its value until the reply.
   */
  const save = useCallback(async (key, patch, { optimistic = false } = {}) => {
    const before = {};
    if (optimistic) {
      setPrefs((prev) => {
        Object.keys(patch).forEach((field) => { before[field] = prev[field]; });
        return { ...prev, ...patch };
      });
    }
    setSavingKeys((prev) => new Set(prev).add(key));
    setError(null);
    setSaveStatus('Saving…');
    try {
      const updated = await updateNotificationPrefs(patch);
      await refreshUser(updated);
      setPrefs(buildPrefs(updated));
      await mutateNotifications();
      setSaveStatus('Saved');
    } catch (err) {
      if (optimistic) setPrefs((prev) => ({ ...prev, ...before }));
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

  const applyToggle = useCallback(
    (channel, event, enabled) => save(`${channel}:${event}`, { [channel]: { [event]: enabled } }),
    [save],
  );

  /** Summaries and quiet hours run on the clock, so the zone shown is saved with them. */
  function withTimeZone(patch) {
    return user?.notificationPrefs?.timeZone ? patch : { ...patch, timeZone: prefs.timeZone };
  }

  function saveQuietHours(change) {
    save('quietHours', withTimeZone({ quietHours: { ...prefs.quietHours, ...change } }), { optimistic: true });
  }

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

  const busy = (key) => resetBusy || savingKeys.has(key);
  const checkboxDisabled = (channel, event) => busy(`${channel}:${event}`);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Notification preferences</h1>
          <p className="sub">Choose which events reach you by email and in the app.</p>
        </div>
        <span className="meta" role="status" aria-live="polite">{saveStatus}</span>
      </div>
      <FormError error={error} />

      <div className="notif-settings__row" role="group" aria-label="Presets">
        <div className="seg">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={activePreset === preset.id}
              disabled={busy(`preset:${preset.id}`)}
              onClick={() => save(`preset:${preset.id}`, preset.prefs, { optimistic: true })}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={handleRestoreDefaults}
          disabled={resetBusy || savingKeys.size > 0}
        >
          Restore defaults
        </button>
      </div>

      <PushDeviceSetting />

      <section className="notif-settings" aria-labelledby="notif-email-heading">
        <h2 id="notif-email-heading">Email</h2>
        {prefs.emailPaused ? (
          <div className="banner banner--info" role="status">
            <div>
              <b>Ticket email is paused</b>
              Nothing about tickets reaches your inbox until you resume it.
            </div>
            <span className="spacer" />
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy('emailPaused')}
              onClick={() => save('emailPaused', { emailPaused: false }, { optimistic: true })}
            >
              Resume email
            </button>
          </div>
        ) : null}
        <div className="notif-settings__row">
          <div className="form-row">
            <label htmlFor="notif-frequency">Email me</label>
            <select
              id="notif-frequency"
              value={prefs.emailFrequency}
              disabled={busy('emailFrequency')}
              onChange={(e) => save(
                'emailFrequency',
                withTimeZone({ emailFrequency: e.target.value }),
                { optimistic: true },
              )}
            >
              {FREQUENCY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="notif-timezone">Time zone</label>
            <select
              id="notif-timezone"
              value={prefs.timeZone}
              disabled={busy('timeZone')}
              onChange={(e) => save('timeZone', { timeZone: e.target.value }, { optimistic: true })}
            >
              {zones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
            </select>
            <p className="help">Used for the daily summary and quiet hours.</p>
          </div>
        </div>
        <label className="notif-settings__check">
          <input
            type="checkbox"
            role="switch"
            checked={prefs.emailPaused}
            disabled={busy('emailPaused')}
            onChange={(e) => save('emailPaused', { emailPaused: e.target.checked }, { optimistic: true })}
          />
          <span>
            Pause all ticket email
            <span className="help">Invites and password resets still arrive.</span>
          </span>
        </label>
      </section>

      <section className="notif-settings" aria-labelledby="notif-quiet-heading">
        <h2 id="notif-quiet-heading">Quiet hours</h2>
        <label className="notif-settings__check">
          <input
            type="checkbox"
            role="switch"
            checked={prefs.quietHours.enabled}
            disabled={busy('quietHours')}
            onChange={(e) => saveQuietHours({ enabled: e.target.checked })}
          />
          <span>
            Turn on quiet hours
            <span className="help">
              Email that comes in during quiet hours waits until they end, and push notifications stay silent.
            </span>
          </span>
        </label>
        <div className="notif-settings__row">
          <QuietTime
            id="notif-quiet-start"
            label="From"
            value={prefs.quietHours.start}
            onCommit={(start) => saveQuietHours({ start })}
          />
          <QuietTime
            id="notif-quiet-end"
            label="Until"
            value={prefs.quietHours.end}
            onCommit={(end) => saveQuietHours({ end })}
          />
        </div>
        <label className="notif-settings__check">
          <input
            type="checkbox"
            checked={prefs.quietHours.allowUrgent}
            disabled={busy('quietHours')}
            onChange={(e) => saveQuietHours({ allowUrgent: e.target.checked })}
          />
          <span>Still notify me for mentions and assignments</span>
        </label>
      </section>

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

/**
 * A time field changes with every digit typed, so the draft stays local and
 * is saved once, when the field loses focus.
 */
function QuietTime({ id, label, value, onCommit }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <div className="form-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="time"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft && draft !== value) onCommit(draft); }}
      />
    </div>
  );
}
