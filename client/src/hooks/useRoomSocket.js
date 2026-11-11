import { useCallback, useEffect, useReducer, useRef } from 'react';
import { WS_URL } from '../services/config.js';
import { errorCode, errorMessage, getMessages, getWsTicket } from '../services/api.js';
import { can } from '../utils/permissions.js';

// Close codes the server uses to say "do not reconnect".
const CLOSE_REMOVED = 4001;
const CLOSE_REPLACED = 4002;
const CLOSE_NOT_FOUND = 4004;
const CLOSE_ROOM_CLOSED = 4005;
const CLOSE_ROOM_FULL = 4006;

const PAGE_SIZE = 30;
const TYPING_TTL_MS = 5000;

const initialState = {
  // connecting | connected | reconnecting | removed | replaced | closed | full | password | error
  status: 'connecting',
  errorText: '',
  me: null,
  participants: [],
  sync: null,
  settings: null,
  chat: [],
  hasMoreChat: false,
  typing: {}, // userId -> { username, until }
  notes: [],
  requests: [], // pending requests (people who can resolve them)
  myRequests: [], // my own requests and their outcome
  queue: [],
  skipVotes: 0,
  skipNeeded: 1,
  poll: null,
  myVote: null,
  pomodoro: null,
  callPeers: [],
  screenShare: null,
};

/** The server is the source of truth: our role is always read back from the participant list. */
function withParticipants(state, participants) {
  const self = participants.find((p) => p.userId === state.me?.userId);
  return { ...state, participants, me: self && state.me ? { ...state.me, role: self.role } : state.me };
}

function reducer(state, action) {
  switch (action.type) {
    case 'status':
      return { ...state, status: action.status };
    case 'fatal':
      return { ...state, status: action.status, errorText: action.text || '' };
    case 'joined': {
      const p = action.payload;
      return {
        ...state,
        status: 'connected',
        errorText: '',
        me: p.you,
        participants: p.participants,
        settings: p.settings,
        chat: p.chat,
        hasMoreChat: p.chat.length >= 50,
        notes: p.notes,
        typing: {},
        // People who may resolve requests get the whole list; everybody else only sees their own.
        requests: can(p.you, p.settings, 'resolve_requests') ? p.requests : [],
        myRequests: p.requests.filter((r) => r.userId === p.you.userId).map((r) => ({ ...r, status: 'pending' })),
        queue: p.queue,
        skipVotes: p.skipVotes,
        skipNeeded: p.skipNeeded,
        poll: p.poll,
        myVote: p.myVote,
        pomodoro: p.pomodoro && { ...p.pomodoro, offset: p.pomodoro.serverTime - Date.now() },
        callPeers: p.callPeers,
        screenShare: p.screenShare,
      };
    }
    case 'sync':
      return { ...state, sync: action.sync };
    case 'participants':
      return withParticipants(state, action.participants);
    case 'settings':
      return { ...state, settings: action.settings };
    case 'chat': {
      const { [action.message.userId]: _gone, ...typing } = state.typing; // they sent it, so they stopped typing
      return { ...state, chat: [...state.chat, action.message].slice(-300), typing };
    }
    case 'chat_prepend':
      return { ...state, chat: [...action.messages, ...state.chat], hasMoreChat: action.messages.length >= PAGE_SIZE };
    case 'typing': {
      const typing = { ...state.typing };
      if (action.isTyping) typing[action.userId] = { username: action.username, until: Date.now() + TYPING_TTL_MS };
      else delete typing[action.userId];
      return { ...state, typing };
    }
    case 'request_list':
      return { ...state, requests: action.requests };
    case 'request_created':
      return { ...state, requests: [...state.requests.filter((r) => r.id !== action.request.id), action.request] };
    case 'request_ack':
      return { ...state, myRequests: [{ ...action.request, status: 'pending' }, ...state.myRequests].slice(0, 6) };
    case 'request_resolved':
      return {
        ...state,
        requests: state.requests.filter((r) => r.id !== action.requestId),
        myRequests: state.myRequests.filter((r) => r.id !== action.requestId),
      };
    case 'queue':
      return { ...state, queue: action.queue, skipVotes: action.skipVotes, skipNeeded: action.skipNeeded };
    case 'poll':
      // myVote is only included for the voter; for everyone else keep what we have (reset for a NEW poll).
      return {
        ...state,
        poll: action.poll,
        myVote: 'myVote' in action ? action.myVote : state.poll?.id === action.poll?.id ? state.myVote : null,
      };
    case 'pomodoro':
      return { ...state, pomodoro: action.pomodoro };
    case 'note_added':
      return { ...state, notes: [...state.notes.filter((n) => n.id !== action.note.id), action.note] };
    case 'note_deleted':
      return { ...state, notes: state.notes.filter((n) => n.id !== action.noteId) };
    case 'call_peer':
      return { ...state, callPeers: [...state.callPeers.filter((p) => p.userId !== action.peer.userId), action.peer] };
    case 'call_peer_left':
      return { ...state, callPeers: state.callPeers.filter((p) => p.userId !== action.userId) };
    case 'call_media':
      return { ...state, callPeers: state.callPeers.map((p) => (p.userId === action.userId ? { ...p, audio: action.audio, video: action.video } : p)) };
    case 'screen_share':
      return { ...state, screenShare: action.screenShare };
    default:
      return state;
  }
}

/**
 * Owns the single native WebSocket for a room: ticket -> connect -> join_room -> messages,
 * with automatic reconnect (fresh ticket every time, because tickets are single-use).
 *
 * Besides the reducer state it offers `subscribe(type, fn)` for one-off events that don't belong
 * in state (emoji reactions, WebRTC signalling).
 */
export function useRoomSocket(roomId, { onToast, onNotify, password } = {}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef(null);
  const listeners = useRef(new Map());
  const callbacks = useRef({ onToast, onNotify });
  callbacks.current = { onToast, onNotify };
  const stateRef = useRef(state);
  stateRef.current = state;

  const subscribe = useCallback((type, fn) => {
    const set = listeners.current.get(type) || new Set();
    set.add(fn);
    listeners.current.set(type, set);
    return () => set.delete(fn);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retries = 0;
    let retryTimer = null;
    let lastVideoId; // undefined until the first sync_state
    let lastPhase = 'idle';

    const toast = (text, kind) => callbacks.current.onToast?.(text, kind);
    const notify = (title, body, opts) => callbacks.current.onNotify?.(title, body, opts);
    const myId = () => stateRef.current.me?.userId;

    function handleMessage({ type, payload }) {
      listeners.current.get(type)?.forEach((fn) => fn(payload));

      switch (type) {
        case 'room_joined':
          retries = 0;
          lastVideoId = undefined;
          dispatch({ type: 'joined', payload });
          if (payload.reconnected) toast('Reconnected', 'success');
          break;
        case 'sync_state':
          // offset = how far the server clock is ahead of ours; used to compute the expected time.
          dispatch({ type: 'sync', sync: { ...payload, offset: payload.serverTime - Date.now() } });
          if (lastVideoId !== undefined && payload.videoId && payload.videoId !== lastVideoId) {
            notify('New video', 'The video was changed in Social - Screen.', { tag: 'video' });
          }
          lastVideoId = payload.videoId;
          break;
        case 'room_settings_updated':
          dispatch({ type: 'settings', settings: payload.settings });
          toast('Room settings were updated');
          break;
        case 'user_joined':
          dispatch({ type: 'participants', participants: payload.participants });
          toast(`${payload.username} joined`);
          break;
        case 'user_left':
          dispatch({ type: 'participants', participants: payload.participants });
          toast(`${payload.username} ${payload.reason === 'timeout' ? 'lost connection' : 'left'}`);
          break;
        case 'participant_removed':
          dispatch({ type: 'participants', participants: payload.participants });
          toast(`${payload.username} was removed`);
          break;
        case 'role_assigned':
          dispatch({ type: 'participants', participants: payload.participants });
          toast(`${payload.username} is now ${payload.role}`);
          break;
        case 'host_transferred':
          dispatch({ type: 'participants', participants: payload.participants });
          toast(`${payload.newHostName} is now the host`);
          break;
        case 'room_closed':
          dispatch({ type: 'fatal', status: 'closed', text: payload.message });
          break;
        case 'removed_from_room':
          dispatch({ type: 'fatal', status: 'removed', text: payload.message });
          notify('Removed from room', payload.message, { force: true });
          break;
        case 'request_list':
          dispatch({ type: 'request_list', requests: payload.requests });
          break;
        case 'request_created':
          dispatch({ type: 'request_created', request: payload });
          notify('New request', `${payload.username} wants to ${payload.type.replace('_', ' ')}.`, { tag: 'request' });
          break;
        case 'request_ack':
          dispatch({ type: 'request_ack', request: payload });
          toast('Request sent');
          break;
        case 'request_resolved':
          dispatch({ type: 'request_resolved', ...payload });
          if (payload.requesterId === myId() && payload.status !== 'cancelled') {
            toast(`Your request was ${payload.status}`, payload.status === 'approved' ? 'success' : 'info');
          }
          break;
        case 'chat_message':
          dispatch({ type: 'chat', message: payload });
          if (payload.userId !== myId()) notify(payload.username, payload.message, { tag: 'chat' });
          break;
        case 'typing':
          dispatch({ type: 'typing', ...payload });
          break;
        case 'queue_updated':
          dispatch({ type: 'queue', ...payload });
          break;
        case 'poll_updated':
          dispatch({ type: 'poll', ...payload });
          break;
        case 'pomodoro_state':
          dispatch({ type: 'pomodoro', pomodoro: { ...payload, offset: payload.serverTime - Date.now() } });
          if (payload.phase !== lastPhase && payload.phase !== 'idle') {
            const text = payload.phase === 'focus' ? 'Focus time. Back to the video!' : 'Break time. Stretch a little.';
            toast(text);
            notify('Social - Screen timer', text, { tag: 'pomodoro' });
          }
          lastPhase = payload.phase;
          break;
        case 'note_added':
          dispatch({ type: 'note_added', note: payload });
          break;
        case 'note_deleted':
          dispatch({ type: 'note_deleted', noteId: payload.noteId });
          break;
        case 'rtc_peer_joined':
          dispatch({ type: 'call_peer', peer: payload });
          break;
        case 'rtc_peer_left':
          dispatch({ type: 'call_peer_left', userId: payload.userId });
          break;
        case 'rtc_media_state':
          dispatch({ type: 'call_media', ...payload });
          break;
        case 'screen_share_state':
          dispatch({ type: 'screen_share', screenShare: payload.screenShare });
          if (payload.screenShare && payload.screenShare.userId !== myId()) toast(`${payload.screenShare.username} is sharing their screen`);
          break;
        case 'error':
          // Signalling noise (e.g. call/screen errors) is handled by the WebRTC hook; everything else is a toast.
          toast(payload.message, 'error');
          break;
        default:
          break;
      }
    }

    function scheduleRetry() {
      if (cancelled) return;
      retries += 1;
      dispatch({ type: 'status', status: 'reconnecting' });
      retryTimer = setTimeout(connect, Math.min(1000 * 2 ** (retries - 1), 10_000));
    }

    async function connect() {
      if (cancelled) return;
      let ticket;
      try {
        ticket = await getWsTicket(roomId, password); // fresh single-use ticket for every (re)connect
      } catch (err) {
        const http = err.response?.status;
        const code = errorCode(err);
        if (code === 'PASSWORD_REQUIRED' || code === 'WRONG_PASSWORD') {
          dispatch({ type: 'fatal', status: 'password', text: code === 'WRONG_PASSWORD' ? errorMessage(err) : '' });
        } else if (code === 'ROOM_FULL') {
          dispatch({ type: 'fatal', status: 'full', text: errorMessage(err) });
        } else if (http === 403 || http === 404 || http === 400) {
          dispatch({ type: 'fatal', status: http === 403 ? 'removed' : 'error', text: errorMessage(err) });
        } else if (http !== 401) {
          scheduleRetry();
        }
        return;
      }
      if (cancelled) return;

      const ws = new WebSocket(`${WS_URL}?ticket=${encodeURIComponent(ticket)}`);
      socketRef.current = ws;

      ws.onopen = () => ws.send(JSON.stringify({ type: 'join_room', payload: { roomId } }));
      ws.onmessage = (event) => {
        if (socketRef.current !== ws) return;
        try {
          handleMessage(JSON.parse(event.data));
        } catch (err) {
          console.error('Bad message from server', err);
        }
      };
      ws.onclose = (event) => {
        if (socketRef.current === ws) socketRef.current = null;
        if (cancelled) return;
        if (event.code === CLOSE_REMOVED) dispatch({ type: 'fatal', status: 'removed', text: 'You were removed from this room.' });
        else if (event.code === CLOSE_REPLACED) dispatch({ type: 'fatal', status: 'replaced', text: 'This room was opened in another tab.' });
        else if (event.code === CLOSE_ROOM_CLOSED) dispatch({ type: 'fatal', status: 'closed', text: 'The host closed this room.' });
        else if (event.code === CLOSE_ROOM_FULL) dispatch({ type: 'fatal', status: 'full', text: 'This room is full.' });
        else if (event.code === CLOSE_NOT_FOUND) dispatch({ type: 'fatal', status: 'error', text: 'Room not found.' });
        else if (event.code !== 1000) scheduleRetry();
      };
    }

    dispatch({ type: 'status', status: 'connecting' });
    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      const ws = socketRef.current;
      socketRef.current = null;
      ws?.close(1000);
    };
  }, [roomId, password]);

  const send = useCallback((type, payload = {}) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
      return true;
    }
    // Typing pings and signalling are fire-and-forget; only real actions deserve a toast.
    if (!type.startsWith('typing') && !type.startsWith('rtc_')) callbacks.current.onToast?.('Not connected. Reconnecting...', 'error');
    return false;
  }, []);

  const leave = useCallback(() => {
    send('leave_room');
  }, [send]);

  /** Older chat messages (cursor = id of the oldest message we have). */
  const loadOlder = useCallback(async () => {
    const oldest = stateRef.current.chat[0];
    if (!oldest) return;
    try {
      const messages = await getMessages(roomId, { before: oldest.id, limit: PAGE_SIZE });
      dispatch({ type: 'chat_prepend', messages });
    } catch (err) {
      callbacks.current.onToast?.(errorMessage(err), 'error');
    }
  }, [roomId]);

  return { state, send, leave, subscribe, loadOlder };
}
