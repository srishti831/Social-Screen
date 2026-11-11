import { useState } from 'react';
import { notificationPermission, notificationsSupported, requestNotificationPermission } from '../services/notify.js';

/** Asks for notification permission only when the user clicks (browsers block automatic prompts). */
export default function NotifyButton({ onToast }) {
  const [permission, setPermission] = useState(notificationPermission());
  if (!notificationsSupported || permission === 'granted') return null;

  async function enable() {
    const result = await requestNotificationPermission();
    setPermission(result);
    if (result === 'granted') onToast?.('Notifications enabled', 'success');
    else if (result === 'denied') onToast?.('Notifications are blocked in your browser settings', 'error');
  }

  return (
    <button type="button" className="btn btn-small btn-icon" onClick={enable} title="Get notified about requests, new videos and removals" aria-label="Enable notifications">
      🔔
    </button>
  );
}
