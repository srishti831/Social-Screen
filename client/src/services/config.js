export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
// No path: the ws server is attached directly to the HTTP server.
export const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:5000';
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

// STUN is enough for most home networks. Strict corporate/mobile networks need a TURN server.
const turn = import.meta.env.VITE_TURN_URL;
export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ...(turn
    ? [{ urls: turn, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }]
    : []),
];

export const MAX_CALL_PEERS = 5;
export const REACTIONS = ['❤️', '😂', '😮', '👏', '🔥', '😢', '👍', '🎉'];
