// Browser notifications. Permission is only asked when the user clicks the bell button.

export const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window;

export const notificationPermission = () => (notificationsSupported ? Notification.permission : 'unsupported');

export async function requestNotificationPermission() {
  if (!notificationsSupported) return 'unsupported';
  return Notification.requestPermission();
}

/**
 * Shows a notification if permission was granted. By default only when the tab is in the
 * background (when it is visible a toast already tells the user). `force` skips that check.
 */
export async function notify(title, body, { force = false, tag } = {}) {
  if (!notificationsSupported || Notification.permission !== 'granted') return;
  if (!force && !document.hidden) return;
  const options = { body, tag, icon: '/icons/icon-192.png' };
  try {
    // Mobile browsers only allow notifications through the service worker.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    /* notifications are a nice-to-have */
  }
}
