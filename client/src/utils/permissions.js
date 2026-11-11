// Mirrors server/src/websocket/constants.js. The server is what really enforces this;
// the client only uses it to show or hide buttons.

export const MOD_PERMISSION_LABELS = {
  control_playback: 'Play, pause, seek and change the video',
  resolve_requests: 'Approve or reject participant requests',
  remove_participant: 'Remove participants from the room',
  manage_queue: 'Reorder the queue and remove any video',
  manage_polls: 'Create and close polls',
  control_pomodoro: 'Start and stop the shared timer',
};

export const DEFAULT_MOD_PERMISSIONS = {
  control_playback: true,
  resolve_requests: true,
  remove_participant: false,
  manage_queue: true,
  manage_polls: true,
  control_pomodoro: true,
};

/** Can the current user do `action` in this room? (settings = room settings from the server) */
export function can(me, settings, action) {
  if (!me) return false;
  const perms = settings?.modPermissions || DEFAULT_MOD_PERMISSIONS;
  if (me.role === 'host') return action !== 'request_control';
  if (me.role === 'moderator') {
    if (action in MOD_PERMISSION_LABELS) return Boolean(perms[action]);
    if (action === 'request_control') return !perms.control_playback;
    return action !== 'manage_roles' && action !== 'transfer_host';
  }
  return action === 'request_control';
}
