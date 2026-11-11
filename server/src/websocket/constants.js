export const ROLES = Object.freeze({
  HOST: 'host',
  MODERATOR: 'moderator',
  PARTICIPANT: 'participant',
});

export const ACTIONS = Object.freeze({
  // Configurable for moderators (the host decides per room, see modPermissions)
  CONTROL_PLAYBACK: 'control_playback',
  RESOLVE_REQUESTS: 'resolve_requests',
  REMOVE_PARTICIPANT: 'remove_participant',
  MANAGE_QUEUE: 'manage_queue',
  MANAGE_POLLS: 'manage_polls',
  CONTROL_POMODORO: 'control_pomodoro',
  // Host only, always
  MANAGE_ROLES: 'manage_roles',
  TRANSFER_HOST: 'transfer_host',
  // Everyone in the room
  CHAT: 'chat',
  REQUEST_CONTROL: 'request_control',
});

export const CONFIGURABLE_ACTIONS = Object.freeze([
  ACTIONS.CONTROL_PLAYBACK,
  ACTIONS.RESOLVE_REQUESTS,
  ACTIONS.REMOVE_PARTICIPANT,
  ACTIONS.MANAGE_QUEUE,
  ACTIONS.MANAGE_POLLS,
  ACTIONS.CONTROL_POMODORO,
]);

export const DEFAULT_MOD_PERMISSIONS = Object.freeze({
  control_playback: true,
  resolve_requests: true,
  remove_participant: false,
  manage_queue: true,
  manage_polls: true,
  control_pomodoro: true,
});

const HOST_ONLY = new Set([ACTIONS.MANAGE_ROLES, ACTIONS.TRANSFER_HOST]);

/**
 * The one place that decides who may do what. The backend checks this on every event.
 * Moderators only get the actions the host switched on for THIS room (modPermissions).
 */
export function can(role, action, modPermissions = DEFAULT_MOD_PERMISSIONS) {
  if (role === ROLES.HOST) return action !== ACTIONS.REQUEST_CONTROL; // host never needs to ask
  if (HOST_ONLY.has(action)) return false;
  if (role === ROLES.MODERATOR) {
    if (CONFIGURABLE_ACTIONS.includes(action)) return Boolean(modPermissions?.[action]);
    // A moderator without playback rights may ask for it, like a participant.
    if (action === ACTIONS.REQUEST_CONTROL) return !modPermissions?.[ACTIONS.CONTROL_PLAYBACK];
    return true;
  }
  // participants
  return action === ACTIONS.CHAT || action === ACTIONS.REQUEST_CONTROL;
}

/** Keeps only known boolean keys, so a client can't smuggle junk into the settings. */
export function sanitizeModPermissions(input, base = DEFAULT_MOD_PERMISSIONS) {
  const result = { ...DEFAULT_MOD_PERMISSIONS, ...base };
  if (input && typeof input === 'object') {
    for (const key of CONFIGURABLE_ACTIONS) {
      if (typeof input[key] === 'boolean') result[key] = input[key];
    }
  }
  return result;
}

export const CLOSE = Object.freeze({
  NORMAL: 1000,
  REMOVED: 4001,
  REPLACED: 4002,
  ROOM_NOT_FOUND: 4004,
  ROOM_CLOSED: 4005,
  ROOM_FULL: 4006,
  JOIN_TIMEOUT: 4008,
});

export const LIMITS = Object.freeze({
  MAX_MESSAGE_BYTES: 16 * 1024, // SDP offers can be a few KB
  MAX_CHAT_LENGTH: 500,
  CHAT_HISTORY: 50,
  MAX_NOTE_LENGTH: 300,
  MAX_QUEUE: 50,
  MAX_POLL_OPTIONS: 6,
  MAX_POLL_QUESTION: 150,
  MAX_POLL_OPTION: 60,
  MAX_CALL_PEERS: 5, // mesh WebRTC gets heavy beyond this
  MAX_SEEK_SECONDS: 24 * 60 * 60,
  MESSAGES_PER_SECOND: 80, // ICE candidates arrive in bursts
  JOIN_TIMEOUT_MS: 10_000,
  HEARTBEAT_MS: 30_000,
  TYPING_AUTO_STOP_MS: 5000,
});

export const ALLOWED_REACTIONS = Object.freeze(['❤️', '😂', '😮', '👏', '🔥', '😢', '👍', '🎉']);

// Tunable in tests via RoomManager options.
export const DEFAULT_OPTIONS = Object.freeze({
  disconnectGraceMs: 45_000,
  emptyRoomMs: 60_000,
  requestTtlMs: 60_000,
});
