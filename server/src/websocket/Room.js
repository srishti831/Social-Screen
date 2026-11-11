import { randomUUID } from 'node:crypto';
import { ACTIONS, CLOSE, DEFAULT_MOD_PERMISSIONS, DEFAULT_OPTIONS, LIMITS, ROLES, can } from './constants.js';
import { Participant } from './Participant.js';
import { encode } from './protocol.js';

const ROLE_ORDER = { [ROLES.HOST]: 0, [ROLES.MODERATOR]: 1, [ROLES.PARTICIPANT]: 2 };
const noop = () => {};

/**
 * One active watch room (in memory). It owns the participants, the authoritative playback
 * state, the shared queue, the poll, the pomodoro timer and the WebRTC call roster.
 * Every outgoing broadcast goes through broadcast / broadcastExcept / broadcastWhere so a
 * Redis Pub/Sub layer could later be added in one place.
 */
export class Room {
  constructor({ roomId, hostId, playback = {}, settings = {}, queue = [], options = {}, hooks = {} }) {
    this.roomId = roomId;
    this.hostId = String(hostId);
    this.createdAt = Date.now();
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.hooks = {
      onEmpty: hooks.onEmpty || noop,
      onHostChange: hooks.onHostChange || noop,
      onQueueChange: hooks.onQueueChange || noop,
      onVideoChange: hooks.onVideoChange || noop,
      onLeave: hooks.onLeave || noop,
    };

    this.settings = {
      name: settings.name || '',
      isPublic: Boolean(settings.isPublic),
      passwordHash: settings.passwordHash || null,
      maxUsers: settings.maxUsers || 10,
      modPermissions: { ...DEFAULT_MOD_PERMISSIONS, ...(settings.modPermissions || {}) },
    };

    this.participants = new Map(); // userId -> Participant
    this.allowed = new Set([this.hostId]); // users who already passed the password check
    this.kicked = new Set();
    this.pendingRequests = new Map();
    this.queue = queue.map((q) => ({ ...q }));
    this.skipVotes = new Set();
    this.endVotes = new Set();
    this.poll = null;
    this.pomodoro = { phase: 'idle', startedAt: 0, duration: 0, focusMin: 25, breakMin: 5, timer: null };
    this.call = new Map(); // userId -> { audio, video }
    this.screenShare = null; // { userId, username, streamId }
    this.evictTimer = null;
    this.closed = false;

    this.playback = {
      videoId: playback.videoId ?? null,
      isPlaying: false,
      currentTime: playback.currentTime ?? 0,
      updatedAt: Date.now(),
    };
  }

  // ---------- permissions & settings ----------

  can(participant, action) {
    return can(participant.role, action, this.settings.modPermissions);
  }

  publicSettings() {
    const { name, isPublic, maxUsers, modPermissions } = this.settings;
    return { name, isPublic, hasPassword: Boolean(this.settings.passwordHash), maxUsers, modPermissions: { ...modPermissions } };
  }

  /** patch: { name, isPublic, passwordHash (null removes it), maxUsers, modPermissions } */
  updateSettings(patch) {
    const passwordChanged = 'passwordHash' in patch && patch.passwordHash !== this.settings.passwordHash;
    this.settings = { ...this.settings, ...patch };
    // After a password change only the people already inside (and the host) skip the new password.
    if (passwordChanged) this.allowed = new Set([this.hostId, ...this.participants.keys()]);

    this.broadcast('room_settings_updated', { settings: this.publicSettings() });
    // Who may resolve requests can change, so everybody gets a fresh view of the list.
    for (const p of this.participants.values()) {
      p.send('request_list', { requests: this.can(p, ACTIONS.RESOLVE_REQUESTS) ? this.getPendingRequests() : [] });
    }
  }

  isFull(userId) {
    return !this.participants.has(userId) && this.participants.size >= this.settings.maxUsers;
  }

  needsPassword(userId) {
    return Boolean(this.settings.passwordHash) && !this.allowed.has(userId) && !this.participants.has(userId);
  }

  // ---------- broadcasting ----------

  broadcast(type, payload) {
    const data = encode(type, payload);
    for (const p of this.participants.values()) p.sendRaw(data);
  }

  broadcastExcept(excludeUserId, type, payload) {
    const data = encode(type, payload);
    for (const p of this.participants.values()) {
      if (p.userId !== excludeUserId) p.sendRaw(data);
    }
  }

  broadcastWhere(predicate, type, payload) {
    const data = encode(type, payload);
    for (const p of this.participants.values()) {
      if (predicate(p)) p.sendRaw(data);
    }
  }

  broadcastToResolvers(type, payload) {
    this.broadcastWhere((p) => this.can(p, ACTIONS.RESOLVE_REQUESTS), type, payload);
  }

  // ---------- membership ----------

  getParticipant(userId) {
    return this.participants.get(userId);
  }

  isKicked(userId) {
    return this.kicked.has(userId);
  }

  hasHost() {
    return [...this.participants.values()].some((p) => p.role === ROLES.HOST);
  }

  connectedCount() {
    return [...this.participants.values()].filter((p) => p.connected).length;
  }

  getParticipantList() {
    return [...this.participants.values()]
      .map((p) => p.toPublic())
      .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joinedAt - b.joinedAt);
  }

  hostName() {
    return [...this.participants.values()].find((p) => p.role === ROLES.HOST)?.username ?? null;
  }

  /** Adds a user, or re-attaches a new socket if they are already a member (refresh/reconnect). */
  join({ userId, username, ws }) {
    const existing = this.participants.get(userId);
    if (existing) {
      const oldSocket = existing.ws;
      existing.attach(ws);
      if (oldSocket && oldSocket !== ws) oldSocket.close(CLOSE.REPLACED, 'Replaced by a new connection');
      return { participant: existing, reconnected: true };
    }

    const role = userId === this.hostId && !this.hasHost() ? ROLES.HOST : ROLES.PARTICIPANT;
    const participant = new Participant({ userId, username, role, ws });
    this.participants.set(userId, participant);
    this.broadcastExcept(userId, 'user_joined', { userId, username, role, participants: this.getParticipantList() });
    return { participant, reconnected: false };
  }

  /** Socket dropped: keep the seat for a grace period so a refresh doesn't lose the role. */
  disconnect(participant, ws) {
    if (this.closed || participant.ws !== ws) return;
    participant.detach();
    clearTimeout(participant.graceTimer);
    participant.graceTimer = setTimeout(() => this.removeParticipant(participant.userId, 'timeout'), this.options.disconnectGraceMs);
    participant.graceTimer.unref?.();
  }

  /** reason: 'left' | 'timeout' | 'removed'. */
  removeParticipant(userId, reason = 'left') {
    const participant = this.participants.get(userId);
    if (!participant) return null;

    clearTimeout(participant.graceTimer);
    clearTimeout(participant.typingTimer);
    this.cancelRequestsFor(userId, 'cancelled');
    this.leaveCall(userId);
    this.stopScreenShare(userId);
    this.skipVotes.delete(userId);
    this.endVotes.delete(userId);
    this.participants.delete(userId);
    this.broadcast('typing', { userId, username: participant.username, isTyping: false });

    const payload = { userId, username: participant.username, participants: this.getParticipantList() };
    if (reason === 'removed') this.broadcast('participant_removed', payload);
    else this.broadcast('user_left', { ...payload, reason });

    this.hooks.onLeave(this, participant);
    if (participant.role === ROLES.HOST) this.promoteSuccessor();
    if (this.participants.size === 0) this.hooks.onEmpty(this);
    else this.checkSkip(); // fewer people = lower vote threshold
    return participant;
  }

  /** Host (or a permitted moderator) removes someone: tell them, drop them, block them. */
  kick(userId) {
    const participant = this.participants.get(userId);
    if (!participant) return null;
    this.kicked.add(userId);
    this.allowed.delete(userId);
    participant.send('removed_from_room', { roomId: this.roomId, message: 'You were removed from the room' });
    this.removeParticipant(userId, 'removed');
    participant.close(CLOSE.REMOVED, 'Removed');
    return participant;
  }

  // ---------- roles ----------

  assignRole(userId, role) {
    const participant = this.participants.get(userId);
    if (!participant) return null;
    this.cancelRequestsFor(userId, 'cancelled');
    participant.role = role;
    this.broadcast('role_assigned', { userId, username: participant.username, role, participants: this.getParticipantList() });
    if (this.can(participant, ACTIONS.RESOLVE_REQUESTS)) participant.send('request_list', { requests: this.getPendingRequests() });
    return participant;
  }

  /** Atomic swap: nobody is ever Host twice, and the old host becomes a Participant. */
  transferHost(newHostId, reason = 'transfer') {
    const target = this.participants.get(newHostId);
    if (!target) return null;
    const oldHostId = this.hostId;

    this.cancelRequestsFor(newHostId, 'cancelled');
    for (const p of this.participants.values()) {
      if (p.role === ROLES.HOST) p.role = ROLES.PARTICIPANT;
    }
    target.role = ROLES.HOST;
    this.hostId = newHostId;
    this.allowed.add(newHostId);

    this.broadcast('host_transferred', {
      oldHostId,
      newHostId,
      newHostName: target.username,
      reason,
      participants: this.getParticipantList(),
    });
    target.send('request_list', { requests: this.getPendingRequests() });
    this.hooks.onHostChange(this);
    return target;
  }

  /** Host left for good: longest-present Moderator, else longest-present Participant. */
  promoteSuccessor() {
    const candidates = [...this.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    const pick = (role) => candidates.find((p) => p.role === role && p.connected) || candidates.find((p) => p.role === role);
    const successor = pick(ROLES.MODERATOR) || pick(ROLES.PARTICIPANT);
    if (successor) this.transferHost(successor.userId, 'succession');
  }

  // ---------- playback (server is the source of truth) ----------

  getExpectedTime(now = Date.now()) {
    const { isPlaying, currentTime, updatedAt } = this.playback;
    return isPlaying ? currentTime + (now - updatedAt) / 1000 : currentTime;
  }

  /** `updatedAt` is generated here and doubles as the playback "version" clients report back. */
  applyPlayback(type, payload = {}, now = Date.now()) {
    const current = this.playback;
    switch (type) {
      case 'play':
        this.playback = { ...current, currentTime: this.getExpectedTime(now), isPlaying: true, updatedAt: now };
        break;
      case 'pause':
        this.playback = { ...current, currentTime: this.getExpectedTime(now), isPlaying: false, updatedAt: now };
        break;
      case 'seek':
        this.playback = { ...current, currentTime: payload.time, updatedAt: now };
        break;
      case 'change_video':
        this.playback = { videoId: payload.videoId, currentTime: 0, isPlaying: true, updatedAt: now };
        this.skipVotes.clear();
        break;
      default:
        throw new Error(`Unknown playback action: ${type}`);
    }
    this.endVotes.clear(); // a new version: earlier "video ended" reports no longer count
    if (type === 'change_video') this.hooks.onVideoChange(this);
  }

  getSyncPayload(now = Date.now()) {
    return { ...this.playback, serverTime: now };
  }

  broadcastSync() {
    this.broadcast('sync_state', this.getSyncPayload());
  }

  // ---------- shared queue ----------

  skipNeeded() {
    return Math.floor(this.participants.size / 2) + 1; // more than half
  }

  queuePayload() {
    return { queue: this.queue.map((q) => ({ ...q })), skipVotes: this.skipVotes.size, skipNeeded: this.skipNeeded() };
  }

  broadcastQueue() {
    this.broadcast('queue_updated', this.queuePayload());
  }

  addToQueue(participant, videoId) {
    const item = { id: randomUUID(), videoId, title: null, addedBy: participant.userId, addedByName: participant.username };
    this.queue.push(item);
    this.broadcastQueue();
    this.hooks.onQueueChange(this);
    return item;
  }

  setQueueTitle(itemId, title) {
    const item = this.queue.find((q) => q.id === itemId);
    if (!item || !title) return;
    item.title = title;
    this.broadcastQueue();
    this.hooks.onQueueChange(this);
  }

  removeFromQueue(itemId) {
    const index = this.queue.findIndex((q) => q.id === itemId);
    if (index === -1) return null;
    const [item] = this.queue.splice(index, 1);
    this.broadcastQueue();
    this.hooks.onQueueChange(this);
    return item;
  }

  moveInQueue(itemId, toIndex) {
    const from = this.queue.findIndex((q) => q.id === itemId);
    if (from === -1) return false;
    const to = Math.min(Math.max(toIndex, 0), this.queue.length - 1);
    const [item] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, item);
    this.broadcastQueue();
    this.hooks.onQueueChange(this);
    return true;
  }

  /** Plays the given queue item now (it leaves the queue) and syncs everybody. */
  playQueueItem(itemId) {
    const index = this.queue.findIndex((q) => q.id === itemId);
    if (index === -1) return null;
    const [item] = this.queue.splice(index, 1);
    this.applyPlayback('change_video', { videoId: item.videoId });
    this.broadcastSync();
    this.broadcastQueue();
    this.hooks.onQueueChange(this);
    return item;
  }

  /** Plays the next queued video (used when a video ends or a skip vote passes). */
  advanceQueue() {
    const next = this.queue[0];
    return next ? this.playQueueItem(next.id) : null;
  }

  /** Returns 'nothing' | 'voted' | 'skipped'. */
  voteSkip(userId) {
    if (!this.playback.videoId || this.queue.length === 0) return 'nothing';
    this.skipVotes.add(userId);
    if (this.skipVotes.size >= this.skipNeeded()) {
      this.advanceQueue();
      return 'skipped';
    }
    this.broadcastQueue();
    return 'voted';
  }

  /** Re-evaluates a running skip vote (e.g. after someone leaves and the threshold drops). */
  checkSkip() {
    if (this.skipVotes.size === 0) return;
    if (this.queue.length > 0 && this.skipVotes.size >= this.skipNeeded()) this.advanceQueue();
    else this.broadcastQueue();
  }

  /**
   * A client's player reached the end. Hosts/permitted moderators are trusted immediately;
   * otherwise at least half of the connected people must report it, so one user can't skip.
   */
  registerVideoEnd(participant) {
    if (!this.can(participant, ACTIONS.CONTROL_PLAYBACK)) {
      this.endVotes.add(participant.userId);
      if (this.endVotes.size < Math.ceil(this.connectedCount() / 2)) return false;
    }
    if (this.queue.length > 0) {
      this.advanceQueue();
    } else {
      this.applyPlayback('pause'); // nothing left: stop everyone at the end
      this.broadcastSync();
    }
    return true;
  }

  // ---------- control requests ----------

  getPendingRequests() {
    return [...this.pendingRequests.values()].map(Room.publicRequest);
  }

  getRequestsFor(userId) {
    return this.getPendingRequests().filter((r) => r.userId === userId);
  }

  static publicRequest(r) {
    return { id: r.id, userId: r.userId, username: r.username, type: r.type, payload: r.payload, createdAt: r.createdAt };
  }

  /** At most one pending request per user per type; a new one replaces the old. */
  createRequest(participant, type, payload) {
    for (const r of [...this.pendingRequests.values()]) {
      if (r.userId === participant.userId && r.type === type) this.closeRequest(r, 'cancelled');
    }
    const request = {
      id: randomUUID(),
      userId: participant.userId,
      username: participant.username,
      type,
      payload,
      createdAt: Date.now(),
    };
    request.timer = setTimeout(() => this.closeRequest(request, 'expired'), this.options.requestTtlMs);
    request.timer.unref?.();
    this.pendingRequests.set(request.id, request);

    const view = Room.publicRequest(request);
    participant.send('request_ack', view);
    this.broadcastToResolvers('request_created', view);
    return request;
  }

  closeRequest(request, status, resolvedBy = null) {
    clearTimeout(request.timer);
    this.pendingRequests.delete(request.id);
    const payload = { requestId: request.id, type: request.type, status, requesterId: request.userId, resolvedBy };
    this.broadcastToResolvers('request_resolved', payload);
    const requester = this.participants.get(request.userId);
    if (requester && !this.can(requester, ACTIONS.RESOLVE_REQUESTS)) requester.send('request_resolved', payload);
  }

  cancelRequestsFor(userId, status) {
    for (const r of [...this.pendingRequests.values()]) {
      if (r.userId === userId) this.closeRequest(r, status);
    }
  }

  /** Approving applies the action exactly as if a privileged user had done it. */
  resolveRequest(requestId, resolver, approve) {
    const request = this.pendingRequests.get(requestId);
    if (!request) return null;
    this.closeRequest(request, approve ? 'approved' : 'rejected', resolver.userId);
    if (approve) {
      this.applyPlayback(request.type, request.payload);
      this.broadcastSync();
    }
    return request;
  }

  // ---------- reactions & typing ----------

  react(participant, emoji) {
    this.broadcast('reaction', { id: randomUUID(), userId: participant.userId, username: participant.username, emoji });
  }

  setTyping(participant, isTyping) {
    clearTimeout(participant.typingTimer);
    participant.typingTimer = null;
    if (isTyping) {
      // Safety net: if the client never sends typing_stop, we stop it for them.
      participant.typingTimer = setTimeout(() => this.setTyping(participant, false), LIMITS.TYPING_AUTO_STOP_MS);
      participant.typingTimer.unref?.();
    }
    this.broadcastExcept(participant.userId, 'typing', { userId: participant.userId, username: participant.username, isTyping });
  }

  // ---------- polls ----------

  publicPoll() {
    if (!this.poll) return null;
    const counts = new Map();
    for (const optionId of this.poll.votes.values()) counts.set(optionId, (counts.get(optionId) || 0) + 1);
    return {
      id: this.poll.id,
      question: this.poll.question,
      options: this.poll.options.map((o) => ({ id: o.id, text: o.text, count: counts.get(o.id) || 0 })),
      total: this.poll.votes.size,
      closed: this.poll.closed,
      createdBy: this.poll.createdBy,
      createdByName: this.poll.createdByName,
    };
  }

  createPoll(participant, question, optionTexts) {
    this.poll = {
      id: randomUUID(),
      question,
      options: optionTexts.map((text) => ({ id: randomUUID().slice(0, 8), text })),
      votes: new Map(), // userId -> optionId (one vote per user)
      createdBy: participant.userId,
      createdByName: participant.username,
      closed: false,
    };
    this.broadcast('poll_updated', { poll: this.publicPoll(), myVote: null });
    return this.poll;
  }

  /** Returns 'ok' | 'no_poll' | 'closed' | 'invalid_option' | 'already_voted'. */
  votePoll(participant, pollId, optionId) {
    if (!this.poll || this.poll.id !== pollId) return 'no_poll';
    if (this.poll.closed) return 'closed';
    if (!this.poll.options.some((o) => o.id === optionId)) return 'invalid_option';
    if (this.poll.votes.has(participant.userId)) return 'already_voted';
    this.poll.votes.set(participant.userId, optionId);
    // Everyone sees the live counts; only the voter learns which option is theirs.
    this.broadcastExcept(participant.userId, 'poll_updated', { poll: this.publicPoll() });
    participant.send('poll_updated', { poll: this.publicPoll(), myVote: optionId });
    return 'ok';
  }

  closePoll(pollId) {
    if (!this.poll || this.poll.id !== pollId || this.poll.closed) return false;
    this.poll.closed = true;
    this.broadcast('poll_updated', { poll: this.publicPoll() });
    return true;
  }

  // ---------- shared pomodoro ----------

  /** Clients count down on their own from { phase, startedAt, duration }; no per-second traffic. */
  pomodoroPayload(now = Date.now()) {
    const { phase, startedAt, duration, focusMin, breakMin } = this.pomodoro;
    return { phase, startedAt, duration, focusMin, breakMin, serverTime: now };
  }

  startPomodoro(focusMin, breakMin) {
    this.pomodoro.focusMin = focusMin;
    this.pomodoro.breakMin = breakMin;
    this.enterPomodoroPhase('focus');
  }

  enterPomodoroPhase(phase) {
    clearTimeout(this.pomodoro.timer);
    const minutes = phase === 'focus' ? this.pomodoro.focusMin : this.pomodoro.breakMin;
    this.pomodoro.phase = phase;
    this.pomodoro.startedAt = Date.now();
    this.pomodoro.duration = minutes * 60;
    // The server flips focus <-> break by itself, so the timer keeps going without any client.
    this.pomodoro.timer = setTimeout(() => this.enterPomodoroPhase(phase === 'focus' ? 'break' : 'focus'), minutes * 60_000);
    this.pomodoro.timer.unref?.();
    this.broadcast('pomodoro_state', this.pomodoroPayload());
  }

  stopPomodoro() {
    clearTimeout(this.pomodoro.timer);
    this.pomodoro.timer = null;
    this.pomodoro.phase = 'idle';
    this.pomodoro.startedAt = 0;
    this.pomodoro.duration = 0;
    this.broadcast('pomodoro_state', this.pomodoroPayload());
  }

  // ---------- WebRTC signalling (voice / video / screen share) ----------

  callPeers() {
    return [...this.call.entries()].map(([userId, media]) => ({
      userId,
      username: this.participants.get(userId)?.username ?? '',
      ...media,
    }));
  }

  /** Returns the peers already in the call, or null when the call is full. */
  joinCall(participant, media) {
    const rejoin = this.call.has(participant.userId);
    if (!rejoin && this.call.size >= LIMITS.MAX_CALL_PEERS) return null;
    const peers = this.callPeers().filter((p) => p.userId !== participant.userId);
    this.call.set(participant.userId, { audio: Boolean(media.audio), video: Boolean(media.video) });
    this.broadcastExcept(participant.userId, 'rtc_peer_joined', {
      userId: participant.userId,
      username: participant.username,
      audio: Boolean(media.audio),
      video: Boolean(media.video),
    });
    return peers;
  }

  leaveCall(userId) {
    if (!this.call.delete(userId)) return false;
    this.stopScreenShare(userId);
    this.broadcast('rtc_peer_left', { userId });
    return true;
  }

  setCallMedia(userId, media) {
    if (!this.call.has(userId)) return false;
    const next = { audio: Boolean(media.audio), video: Boolean(media.video) };
    this.call.set(userId, next);
    this.broadcastExcept(userId, 'rtc_media_state', { userId, ...next });
    return true;
  }

  /** Forwards an offer / answer / ICE candidate between two people who are both in the call. */
  relaySignal(fromId, toId, type, data) {
    if (!this.call.has(fromId) || !this.call.has(toId) || fromId === toId) return false;
    this.participants.get(toId)?.send(type, { from: fromId, ...data });
    return true;
  }

  /** One sharer at a time. Returns false if somebody else is already sharing. */
  startScreenShare(participant, streamId) {
    if (this.screenShare && this.screenShare.userId !== participant.userId) return false;
    this.screenShare = { userId: participant.userId, username: participant.username, streamId };
    this.broadcast('screen_share_state', { screenShare: this.screenShare });
    return true;
  }

  stopScreenShare(userId) {
    if (!this.screenShare || this.screenShare.userId !== userId) return false;
    this.screenShare = null;
    this.broadcast('screen_share_state', { screenShare: null });
    return true;
  }

  // ---------- join snapshot ----------

  /** Everything a (re)connecting client needs to rebuild its screen. */
  getJoinState(participant) {
    return {
      settings: this.publicSettings(),
      ...this.queuePayload(),
      poll: this.publicPoll(),
      myVote: this.poll?.votes.get(participant.userId) ?? null,
      pomodoro: this.pomodoroPayload(),
      callPeers: this.callPeers(),
      screenShare: this.screenShare,
      requests: this.can(participant, ACTIONS.RESOLVE_REQUESTS) ? this.getPendingRequests() : this.getRequestsFor(participant.userId),
    };
  }

  // ---------- lifecycle ----------

  /** The host deleted the room: tell everyone, disconnect them, and stop all timers. */
  close(message) {
    this.closed = true;
    this.broadcast('room_closed', { roomId: this.roomId, message });
    for (const p of this.participants.values()) p.close(CLOSE.ROOM_CLOSED, 'Room closed');
    this.destroy();
    this.participants.clear();
  }

  destroy() {
    clearTimeout(this.evictTimer);
    clearTimeout(this.pomodoro.timer);
    for (const p of this.participants.values()) {
      clearTimeout(p.graceTimer);
      clearTimeout(p.typingTimer);
    }
    for (const r of this.pendingRequests.values()) clearTimeout(r.timer);
    this.pendingRequests.clear();
  }
}
