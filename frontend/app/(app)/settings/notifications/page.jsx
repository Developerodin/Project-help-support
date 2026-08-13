'use client';

import { useState } from 'react';
import { NOTIFICATION_EVENTS, DEFAULT_NOTIFICATION_PREFS } from '@pms/shared';
import { updateNotificationPrefs } from '@/shared/api/users.js';
import { useAuth } from '@/shared/contexts/auth-context.jsx';
import FormError from '@/shared/components/form-error.jsx';

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState({
    email: { ...DEFAULT_NOTIFICATION_PREFS.email, ...(user?.notificationPrefs?.email || {}) },
    inApp: { ...DEFAULT_NOTIFICATION_PREFS.inApp, ...(user?.notificationPrefs?.inApp || {}) },
  });
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const toggle = (channel, event) => () => {
    setSaved(false);
    setPrefs({ ...prefs, [channel]: { ...prefs[channel], [event]: !prefs[channel][event] } });
  };

  async function save() {
    setError(null);
    try {
      await updateNotificationPrefs(prefs);
      setSaved(true);
    } catch (err) { setError(err); }
  }

  return (
    <>
      <h1>Notification preferences</h1>
      <FormError error={error} />

      <table>
        <thead><tr><th>Event</th><th>In app</th><th>Email</th></tr></thead>
        <tbody>
          {NOTIFICATION_EVENTS.map((event) => (
            <tr key={event}>
              <td>{event}</td>
              <td>
                <input type="checkbox" aria-label={`${event} in app`}
                  checked={prefs.inApp[event]} onChange={toggle('inApp', event)} />
              </td>
              <td>
                <input type="checkbox" aria-label={`${event} email`}
                  checked={prefs.email[event]} onChange={toggle('email', event)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button type="button" onClick={save}>Save</button>
      {saved && <span> Saved.</span>}
    </>
  );
}
