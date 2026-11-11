import { ACTIONS, ALLOWED_REACTIONS, CLOSE, LIMITS, ROLES } from './constants.js';
import { sendError } from './protocol.js';
import { RateLimiter } from '../utils/rateLimiter.js';
import { normalizeRoomCode } from '../utils/roomCode.js';
import { fetchVideoTitle, parseVideoId } from '../utils/youtube.js';
import { persistence as defaultPersistence } from '../services/persistence.js';

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Parses, validates and authorizes every incoming WebSocket message, then delegates to Room.
 * Check order for every protected event:
 *   authenticated (ticket) -> in a room -> role/permission -> rate limit -> payload valid -> mutate -> broadcast
 */
export class MessageHandler {
  constructor({ roomManager, persistence = defaultPersistence }) {
    this.roomManager = roomManager;
    this.persistence = persistence;
    this.handlers = {
      join_room: this.joinRoom,
      leave_room: this.leaveRoom,
      request_sync: this.requestSync,
      // playback
      play: (ctx, p) => this.controlPlayback(ctx, 'play', p),
      pause: (ctx, p) => this.controlPlayback(ctx, 'pause', p),
      seek: (ctx, p) => this.controlPlayback(ctx, 'seek', p),
      change_video: (ctx, p) => this.controlPlayback(ctx, 'change_video', p),
      request_play: (ctx, p) => this.requestAction(ctx, 'play', p),
      request_pause: (ctx, p) => this.requestAction(ctx, 'pause', p),
      request_seek: (ctx, p) => this.requestAction(ctx, 'seek', p),
      request_change_video: (ctx, p) => this.requestAction(ctx, 'change_video', p),
      approve_request: (ctx, p) => this.resolveRequest(ctx, p, true),
      reject_request: (ctx, p) => this.resolveRequest(ctx, p, false),
      // people
      assign_role: this.assignRole,
      remove_participant: this.removeParticipant,
      transfer_host: this.transferHost,
      // chat, reactions, typing
      chat_message: this.chatMessage,
      send_reaction: this.sendReaction,
      typing_start: (ctx) => this.typing(ctx, true),
      typing_stop: (ctx) => this.typing(ctx, false),
      // shared queue
      queue_add: this.queueAdd,
      queue_remove: this.queueRemove,
      queue_reorder: this.queueReorder,
      queue_play: this.queuePlay,
      queue_vote_skip: this.queueVoteSkip,
      video_ended: this.videoEnded,
      // polls, notes, pomodoro
      poll_create: this.pollCreate,
      poll_vote: this.pollVote,
      poll_close: this.pollClose,
      note_add: this.noteAdd,
      note_delete: this.noteDelete,
      pomodoro_start: this.pomodoroStart,
      pomodoro_stop: this.pomodoroStop,
      // WebRTC signalling + screen share
      rtc_join: this.rtcJoin,
      rtc_leave: this.rtcLeave,
      rtc_media: this.rtcMedia,
      rtc_offer: (ctx, p) => this.rtcSignal(ctx, 'rtc_offer', p),
      rtc_answer: (ctx, p) => this.rtcSignal(ctx, 'rtc_answer', p),
      rtc_ice: (ctx, p) => this.rtcSignal(ctx, 'rtc_ice', p),
      screen_share_start: this.screenShareStart,
      screen_share_stop: this.screenShareStop,
    };
  }

  /** `session` comes from the validated ticket: userId/username/roomId are server-decided. */
  handleConnection(ws, session) {
    const ctx = {
      ws,
      session,
      room: null,
      participant: null,
      limiter: new RateLimiter(LIMITS.MESSAGES_PER_SECOND, 1000),
      queue: Promise.resolve(), // messages from one socket are processed strictly in order
    };

    const joinTimer = setTimeout(() => {
      if (!ctx.participant) ws.close(CLOSE.JOIN_TIMEOUT, 'join_room required');
    }, LIMITS.JOIN_TIMEOUT_MS);
    joinTimer.unref?.();

    ws.on('message', (data) => {
      if (!ctx.limiter.allow()) return sendError(ws, 'RATE_LIMITED', 'Too many messages, slow down');
      ctx.queue = ctx.queue.then(() => this.process(ctx, data));
      return undefined;
    });
    ws.on('close', () => {
      clearTimeout(joinTimer);
      if (ctx.room && ctx.participant) ctx.room.disconnect(ctx.participant, ws);
    });
    ws.on('error', (err) => console.error('WebSocket error', err.message));
  }

  async process(ctx, data) {
    const { ws } = ctx;
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return sendError(ws, 'INVALID_JSON', 'Message must be valid JSON');
    }
    if (!isPlainObject(message) || typeof message.type !== 'string') {
      return sendError(ws, 'INVALID_MESSAGE', 'Message must look like { "type": string, "payload": object }');
    }
    if (message.payload !== undefined && !isPlainObject(message.payload)) {
      return sendError(ws, 'INVALID_MESSAGE', 'payload must be an object');
    }
    const handler = Object.hasOwn(this.handlers, message.type) ? this.handlers[message.type] : null;
    if (!handler) return sendError(ws, 'UNKNOWN_EVENT', `Unknown event type: ${message.type}`);

    try {
      return await handler.call(this, ctx, message.payload ?? {});
    } catch (err) {
      console.error(`Error handling "${message.type}"`, err);
      return sendError(ws, 'INTERNAL_ERROR', 'Something went wrong');
    }
  }

  // ---------- helpers ----------

  /** Returns { room, participant } only if the socket's user is still a member of its room. */
  member(ctx) {
    const { room, participant } = ctx;
    if (!room || !participant || room.getParticipant(participant.userId) !== participant) {
      sendError(ctx.ws, 'NOT_IN_ROOM', 'Join a room first');
      return null;
    }
    return { room, participant };
  }

  /** member() + permission check (role + this room's moderator settings). */
  authorize(ctx, action, message) {
    const found = this.member(ctx);
    if (!found) return null;
    if (!found.room.can(found.participant, action)) {
      sendError(ctx.ws, 'FORBIDDEN', message);
      return null;
    }
    return found;
  }

  /** member() + per-user rate limit. */
  limited(ctx, limiterName, message = 'You are doing that too quickly') {
    const found = this.member(ctx);
    if (!found) return null;
    if (!found.participant.limits[limiterName].allow()) {
      sendError(ctx.ws, 'RATE_LIMITED', message);
      return null;
    }
    return found;
  }

  validatePlayback(room, type, payload) {
    if (type === 'change_video') {
      const videoId = parseVideoId(payload.videoId ?? payload.url);
      return videoId ? { payload: { videoId } } : { error: ['INVALID_VIDEO', 'Not a valid YouTube URL or video ID'] };
    }
    if (!room.playback.videoId) return { error: ['NO_VIDEO', 'No video is loaded yet'] };
    if (type === 'seek') {
      const time = payload.time;
      if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > LIMITS.MAX_SEEK_SECONDS) {
        return { error: ['INVALID_PAYLOAD', 'time must be a number of seconds >= 0'] };
      }
      return { payload: { time } };
    }
    return { payload: {} };
  }

  /** Target of a host action: must be another member of the same room. */
  target(ctx, payload, room, participant) {
    if (typeof payload.userId !== 'string') {
      sendError(ctx.ws, 'INVALID_PAYLOAD', 'userId is required');
      return null;
    }
    const target = room.getParticipant(payload.userId);
    if (!target) {
      sendError(ctx.ws, 'TARGET_NOT_FOUND', 'That user is not in the room');
      return null;
    }
    if (target.userId === participant.userId) {
      sendError(ctx.ws, 'INVALID_TARGET', 'You cannot do that to yourself');
      return null;
    }
    return target;
  }

  // ---------- membership ----------

  async joinRoom(ctx, payload) {
    if (ctx.participant) return sendError(ctx.ws, 'ALREADY_JOINED', 'Already in a room');

    const roomId = normalizeRoomCode(payload.roomId);
    // The ticket was issued for one specific room; it cannot be used to enter another.
    if (!roomId || roomId !== ctx.session.roomId) {
      return sendError(ctx.ws, 'ROOM_MISMATCH', 'This ticket was issued for a different room');
    }

    const room = await this.roomManager.getOrLoadRoom(roomId);
    if (!room) {
      sendError(ctx.ws, 'ROOM_NOT_FOUND', 'Room not found');
      return ctx.ws.close(CLOSE.ROOM_NOT_FOUND, 'Room not found');
    }
    const { userId, username } = ctx.session;
    if (room.isKicked(userId)) {
      sendError(ctx.ws, 'REMOVED', 'You were removed from this room');
      return ctx.ws.close(CLOSE.REMOVED, 'Removed');
    }

    // History comes from MongoDB: the last 50 messages and the saved timestamp notes.
    const [chat, notes] = await Promise.all([
      this.persistence.getMessages(roomId, { limit: LIMITS.CHAT_HISTORY }),
      this.persistence.listNotes(roomId),
    ]);

    // Checked again here (not only when the ticket was issued) so two people can't squeeze in at once.
    if (room.isFull(userId)) {
      sendError(ctx.ws, 'ROOM_FULL', 'This room is full');
      return ctx.ws.close(CLOSE.ROOM_FULL, 'Room full');
    }

    this.roomManager.cancelEviction(room);
    const { participant, reconnected } = room.join({ userId, username, ws: ctx.ws });
    ctx.room = room;
    ctx.participant = participant;
    if (!reconnected) {
      this.persistence.recordJoin(userId, roomId).catch((err) => console.error('Failed to record join', err));
    }

    participant.send('room_joined', {
      roomId,
      you: participant.toPublic(),
      participants: room.getParticipantList(),
      chat,
      notes,
      reconnected,
      serverTime: Date.now(),
      ...room.getJoinState(participant),
    });
    participant.send('sync_state', room.getSyncPayload()); // late joiners/reconnects land in sync
    return undefined;
  }

  leaveRoom(ctx) {
    const found = this.member(ctx);
    if (!found) return;
    found.room.removeParticipant(found.participant.userId, 'left');
    ctx.room = null;
    ctx.participant = null;
    ctx.ws.close(CLOSE.NORMAL, 'Left room');
  }

  requestSync(ctx) {
    const found = this.member(ctx);
    if (found) found.participant.send('sync_state', found.room.getSyncPayload());
  }

  // ---------- playback ----------

  controlPlayback(ctx, type, payload) {
    const found = this.authorize(ctx, ACTIONS.CONTROL_PLAYBACK, 'You do not have permission to control playback in this room');
    if (!found) return;
    const result = this.validatePlayback(found.room, type, payload);
    if (result.error) return sendError(ctx.ws, ...result.error);

    found.room.applyPlayback(type, result.payload); // change_video persists itself via the room hook
    found.room.broadcastSync();
    return undefined;
  }

  requestAction(ctx, type, payload) {
    const found = this.authorize(ctx, ACTIONS.REQUEST_CONTROL, 'You can control playback directly, no request needed');
    if (!found) return;
    const { room, participant } = found;
    if (!participant.limits.request.allow()) {
      return sendError(ctx.ws, 'RATE_LIMITED', 'Wait a moment before sending another request');
    }
    const result = this.validatePlayback(room, type, payload);
    if (result.error) return sendError(ctx.ws, ...result.error);

    // A request never touches playback. It only waits for a decision.
    room.createRequest(participant, type, result.payload);
    return undefined;
  }

  resolveRequest(ctx, payload, approve) {
    const found = this.authorize(ctx, ACTIONS.RESOLVE_REQUESTS, 'You do not have permission to answer requests');
    if (!found) return;
    if (typeof payload.requestId !== 'string') {
      return sendError(ctx.ws, 'INVALID_PAYLOAD', 'requestId is required');
    }
    const request = found.room.resolveRequest(payload.requestId, found.participant, approve);
    if (!request) return sendError(ctx.ws, 'REQUEST_NOT_FOUND', 'That request is no longer pending');
    return undefined;
  }

  // ---------- host management ----------

  assignRole(ctx, payload) {
    const found = this.authorize(ctx, ACTIONS.MANAGE_ROLES, 'Only the Host can assign roles');
    if (!found) return;
    if (payload.role !== ROLES.MODERATOR && payload.role !== ROLES.PARTICIPANT) {
      return sendError(ctx.ws, 'INVALID_PAYLOAD', 'role must be "moderator" or "participant"');
    }
    const target = this.target(ctx, payload, found.room, found.participant);
    if (!target || target.role === payload.role) return;
    found.room.assignRole(target.userId, payload.role);
  }

  removeParticipant(ctx, payload) {
    const found = this.authorize(ctx, ACTIONS.REMOVE_PARTICIPANT, 'You do not have permission to remove people');
    if (!found) return;
    const target = this.target(ctx, payload, found.room, found.participant);
    if (!target) return;
    // A moderator (when the host allows it) can only remove plain participants.
    if (found.participant.role === ROLES.MODERATOR && target.role !== ROLES.PARTICIPANT) {
      return sendError(ctx.ws, 'FORBIDDEN', 'Moderators can only remove participants');
    }
    found.room.kick(target.userId);
  }

  transferHost(ctx, payload) {
    const found = this.authorize(ctx, ACTIONS.TRANSFER_HOST, 'Only the Host can transfer the Host role');
    if (!found) return;
    const target = this.target(ctx, payload, found.room, found.participant);
    if (target) found.room.transferHost(target.userId);
  }

  // ---------- chat, reactions, typing ----------

  async chatMessage(ctx, payload) {
    const found = this.authorize(ctx, ACTIONS.CHAT, 'You cannot chat in this room');
    if (!found) return;
    const text = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (!text || text.length > LIMITS.MAX_CHAT_LENGTH) {
      return sendError(ctx.ws, 'INVALID_PAYLOAD', `Message must be 1-${LIMITS.MAX_CHAT_LENGTH} characters`);
    }
    if (!found.participant.limits.chat.allow()) {
      return sendError(ctx.ws, 'RATE_LIMITED', 'You are sending messages too quickly');
    }

    const { room, participant } = found;
    const saved = await this.persistence.saveMessage({
      roomId: room.roomId,
      userId: participant.userId,
      username: participant.username,
      text,
    });
    room.setTyping(participant, false);
    room.broadcast('chat_message', saved);
    return undefined;
  }

  sendReaction(ctx, payload) {
    const found = this.limited(ctx, 'reaction', 'Slow down with the reactions');
    if (!found) return;
    if (!ALLOWED_REACTIONS.includes(payload.emoji)) {
      return sendError(ctx.ws, 'INVALID_PAYLOAD', 'That reaction is not allowed');
    }
    found.room.react(found.participant, payload.emoji);
    return undefined;
  }

  typing(ctx, isTyping) {
    const { room, participant } = ctx;
    if (!room || !participant || room.getParticipant(participant.userId) !== participant) return; // silent
    if (!participant.limits.typing.allow()) return;
    room.setTyping(participant, isTyping);
  }

  // ---------- shared queue ----------

  queueAdd(ctx, payload) {
    const found = this.limited(ctx, 'queue', 'You are adding videos too quickly');
    if (!found) return;
    const { room, participant } = found;
    const videoId = parseVideoId(payload.videoId ?? payload.url);
    if (!videoId) return sendError(ctx.ws, 'INVALID_VIDEO', 'Not a valid YouTube URL or video ID');
    if (room.queue.length >= LIMITS.MAX_QUEUE) return sendError(ctx.ws, 'QUEUE_FULL', 'The queue is full');

    // Nothing is playing yet and the adder may control playback: start it right away.
    if (!room.playback.videoId && room.can(participant, ACTIONS.CONTROL_PLAYBACK)) {
      room.applyPlayback('change_video', { videoId });
      room.broadcastSync();
      return undefined;
    }

    const item = room.addToQueue(participant, videoId);
    // Title lookup runs in the background so adding never feels slow.
    fetchVideoTitle(videoId).then((title) => room.setQueueTitle(item.id, title));
    return undefined;
  }

  queueRemove(ctx, payload) {
    const found = this.member(ctx);
    if (!found) return;
    const { room, participant } = found;
    const item = room.queue.find((q) => q.id === payload.itemId);
    if (!item) return sendError(ctx.ws, 'NOT_FOUND', 'That video is no longer in the queue');
    const isOwner = item.addedBy === participant.userId;
    if (!isOwner && !room.can(participant, ACTIONS.MANAGE_QUEUE)) {
      return sendError(ctx.ws, 'FORBIDDEN', 'You can only remove videos you added');
    }
    room.removeFromQueue(item.id);
    return undefined;
  }

  queueReorder(ctx, payload) {
    const found = this.authorize(ctx, ACTIONS.MANAGE_QUEUE, 'You do not have permission to reorder the queue');
    if (!found) return;
    if (typeof payload.itemId !== 'string' || !Number.isInteger(payload.toIndex)) {
      return sendError(ctx.ws, 'INVALID_PAYLOAD', 'itemId and toIndex are required');
    }
    if (!found.room.moveInQueue(payload.itemId, payload.toIndex)) {
      return sendError(ctx.ws, 'NOT_FOUND', 'That video is no longer in the queue');
    }
    return undefined;
  }

  queuePlay(ctx, payload) {
    const found = this.authorize(ctx, ACTIONS.CONTROL_PLAYBACK, 'You do not have permission to control playback in this room');
    if (!found) return;
    if (!found.room.playQueueItem(payload.itemId)) {
      return sendError(ctx.ws, 'NOT_FOUND', 'That video is no longer in the queue');
    }
    return undefined;
  }

  queueVoteSkip(ctx) {
    const found = this.member(ctx);
    if (!found) return;
    const result = found.room.voteSkip(found.participant.userId);
    if (result === 'nothing') return sendError(ctx.ws, 'QUEUE_EMPTY', 'There is no next video in the queue');
    return undefined;
  }

  /** `version` must be the sync_state.updatedAt the client was playing, so stale reports are ignored. */
  videoEnded(ctx, payload) {
    const found = this.member(ctx);
    if (!found) return;
    const { room, participant } = found;
    if (payload.videoId !== room.playback.videoId || payload.version !== room.playback.updatedAt) return;
    if (!room.playback.isPlaying) return;
    room.registerVideoEnd(participant);
  }

  // ---------- polls ----------

  pollCreate(ctx, payload) {
    const found = this.authorize(ctx, ACTIONS.MANAGE_POLLS, 'You do not have permission to create polls');
    if (!found) return;
    const { room, participant } = found;
    if (!participant.limits.poll.allow()) return sendError(ctx.ws, 'RATE_LIMITED', 'Too many polls');
    if (room.poll && !room.poll.closed) return sendError(ctx.ws, 'POLL_OPEN', 'Close the current poll first');

    const question = cleanText(payload.question, LIMITS.MAX_POLL_QUESTION);
    const options = Array.isArray(payload.options)
      ? payload.options.map((o) => cleanText(o, LIMITS.MAX_POLL_OPTION)).filter(Boolean)
      : [];
    const unique = [...new Set(options)];
    if (!question || unique.length < 2 || unique.length > LIMITS.MAX_POLL_OPTIONS) {
      return sendError(ctx.ws, 'INVALID_PAYLOAD', `A poll needs a question and 2-${LIMITS.MAX_POLL_OPTIONS} different options`);
    }
    room.createPoll(participant, question, unique);
    return undefined;
  }

  pollVote(ctx, payload) {
    const found = this.member(ctx);
    if (!found) return;
    const result = found.room.votePoll(found.participant, payload.pollId, payload.optionId);
    const messages = {
      no_poll: 'That poll no longer exists',
      closed: 'This poll is closed',
      invalid_option: 'Invalid option',
      already_voted: 'You already voted in this poll',
    };
    if (result !== 'ok') sendError(ctx.ws, 'POLL_ERROR', messages[result]);
  }

  pollClose(ctx, payload) {
    const found = this.member(ctx);
    if (!found) return;
    const { room, participant } = found;
    const isOwner = room.poll?.createdBy === participant.userId;
    if (!isOwner && !room.can(participant, ACTIONS.MANAGE_POLLS)) {
      return sendError(ctx.ws, 'FORBIDDEN', 'You do not have permission to close polls');
    }
    if (!room.closePoll(payload.pollId)) sendError(ctx.ws, 'POLL_ERROR', 'That poll is not open');
  }

  // ---------- timestamp notes ----------

  async noteAdd(ctx, payload) {
    const found = this.limited(ctx, 'note', 'You are adding notes too quickly');
    if (!found) return;
    const { room, participant } = found;
    const text = cleanText(payload.text, LIMITS.MAX_NOTE_LENGTH);
    if (!text) return sendError(ctx.ws, 'INVALID_PAYLOAD', `A note must be 1-${LIMITS.MAX_NOTE_LENGTH} characters`);
    if (!room.playback.videoId) return sendError(ctx.ws, 'NO_VIDEO', 'No video is loaded yet');

    // The time comes from the server's clock, so a note always points at the real playback position.
    const videoTime = Math.floor(room.getExpectedTime() * 10) / 10;
    const note = await this.persistence.createNote({
      roomId: room.roomId,
      userId: participant.userId,
      username: participant.username,
      text,
      videoId: room.playback.videoId,
      videoTime: Math.max(0, videoTime),
    });
    room.broadcast('note_added', note);
    return undefined;
  }

  async noteDelete(ctx, payload) {
    const found = this.member(ctx);
    if (!found) return;
    const { room, participant } = found;
    const note = await this.persistence.findNote(payload.noteId);
    if (!note || note.roomId !== room.roomId) return sendError(ctx.ws, 'NOT_FOUND', 'Note not found');
    if (note.userId !== participant.userId && participant.role !== ROLES.HOST) {
      return sendError(ctx.ws, 'FORBIDDEN', 'You can only delete your own notes');
    }
    await this.persistence.deleteNote(note.id);
    room.broadcast('note_deleted', { noteId: note.id });
    return undefined;
  }

  // ---------- shared pomodoro ----------

  pomodoroStart(ctx, payload) {
    const found = this.authorize(ctx, ACTIONS.CONTROL_POMODORO, 'You do not have permission to control the timer');
    if (!found) return;
    const focus = Number(payload.focusMin);
    const rest = Number(payload.breakMin);
    if (!Number.isInteger(focus) || !Number.isInteger(rest) || focus < 1 || focus > 120 || rest < 1 || rest > 60) {
      return sendError(ctx.ws, 'INVALID_PAYLOAD', 'Focus must be 1-120 minutes and break 1-60 minutes');
    }
    found.room.startPomodoro(focus, rest);
    return undefined;
  }

  pomodoroStop(ctx) {
    const found = this.authorize(ctx, ACTIONS.CONTROL_POMODORO, 'You do not have permission to control the timer');
    if (found) found.room.stopPomodoro();
  }

  // ---------- WebRTC signalling ----------

  rtcJoin(ctx, payload) {
    const found = this.member(ctx);
    if (!found) return;
    const peers = found.room.joinCall(found.participant, { audio: payload.audio, video: payload.video });
    if (!peers) return sendError(ctx.ws, 'CALL_FULL', `The call is full (max ${LIMITS.MAX_CALL_PEERS} people)`);
    // The newcomer starts the connections: it gets the list and offers to everyone in it.
    found.participant.send('rtc_peers', { peers });
    return undefined;
  }

  rtcLeave(ctx) {
    const found = this.member(ctx);
    if (found) found.room.leaveCall(found.participant.userId);
  }

  rtcMedia(ctx, payload) {
    const found = this.member(ctx);
    if (found) found.room.setCallMedia(found.participant.userId, { audio: payload.audio, video: payload.video });
  }

  rtcSignal(ctx, type, payload) {
    const found = this.member(ctx);
    if (!found) return;
    if (typeof payload.to !== 'string') return sendError(ctx.ws, 'INVALID_PAYLOAD', 'to is required');

    let data;
    if (type === 'rtc_ice') {
      if (!isPlainObject(payload.candidate)) return sendError(ctx.ws, 'INVALID_PAYLOAD', 'candidate is required');
      data = { candidate: payload.candidate };
    } else {
      const d = payload.description;
      if (!isPlainObject(d) || typeof d.type !== 'string' || typeof d.sdp !== 'string') {
        return sendError(ctx.ws, 'INVALID_PAYLOAD', 'description is required');
      }
      data = { description: { type: d.type, sdp: d.sdp } };
    }
    if (!found.room.relaySignal(found.participant.userId, payload.to, type, data)) {
      sendError(ctx.ws, 'RTC_ERROR', 'Both people must be in the call');
    }
    return undefined;
  }

  screenShareStart(ctx, payload) {
    const found = this.member(ctx);
    if (!found) return;
    const { room, participant } = found;
    if (!room.call.has(participant.userId)) return sendError(ctx.ws, 'RTC_ERROR', 'Join the call first');
    if (typeof payload.streamId !== 'string' || !payload.streamId || payload.streamId.length > 100) {
      return sendError(ctx.ws, 'INVALID_PAYLOAD', 'streamId is required');
    }
    if (!room.startScreenShare(participant, payload.streamId)) {
      sendError(ctx.ws, 'SCREEN_BUSY', `${room.screenShare.username} is already sharing their screen`);
    }
    return undefined;
  }

  screenShareStop(ctx) {
    const found = this.member(ctx);
    if (found) found.room.stopScreenShare(found.participant.userId);
  }
}
