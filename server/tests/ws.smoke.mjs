import assert from 'node:assert/strict';
import { RoomManager } from '../src/websocket/RoomManager.js';
import { MessageHandler } from '../src/websocket/MessageHandler.js';

let idc = 0;
const db = { messages: [], notes: [], joins: [], leaves: [], queueSaves: 0, videoSaves: [] };
const persistence = {
  findRoom: async () => null,
  saveHost: async () => {}, saveSnapshot: async () => {},
  saveQueue: async () => { db.queueSaves += 1; },
  saveVideo: async (r, v) => { db.videoSaves.push(v); },
  recordLeave: async (...a) => db.leaves.push(a),
  recordJoin: async (...a) => { db.joins.push(a); },
  getMessages: async () => db.messages.slice(-50),
  listNotes: async () => db.notes,
  saveMessage: async (m) => { const x = { id: `m${++idc}`, userId: m.userId, username: m.username, message: m.text, timestamp: Date.now() }; db.messages.push(x); return x; },
  createNote: async (n) => { const x = { id: `n${++idc}`, ...n, createdAt: Date.now() }; db.notes.push(x); return x; },
  findNote: async (id) => db.notes.find((n) => n.id === id) || null,
  deleteNote: async (id) => { db.notes = db.notes.filter((n) => n.id !== id); },
};

const rm = new RoomManager({ persistence });
const handler = new MessageHandler({ roomManager: rm, persistence });
const room = rm.createRoom({ roomId: 'ROOM22', hostId: 'H', settings: { maxUsers: 4, isPublic: true, name: 'Test' }, queue: [] });

function client(userId) {
  const ws = { readyState: 1, sent: [], handlers: {}, closed: null,
    send(d) { this.sent.push(JSON.parse(d)); }, close(c) { this.closed = c; this.readyState = 3; },
    on(e, f) { this.handlers[e] = f; } };
  const ctx = handler.handleConnection(ws, { userId, username: `user-${userId}`, roomId: 'ROOM22' });
  const c = { ws, userId,
    async send(type, payload = {}) { ws.handlers.message(JSON.stringify({ type, payload })); await new Promise((r) => setTimeout(r, 15)); },
    last: (type) => [...ws.sent].reverse().find((m) => m.type === type),
    all: (type) => ws.sent.filter((m) => m.type === type),
    clear() { ws.sent.length = 0; } };
  return c;
}
const H = client('H'), A = client('A'), B = client('B'), C = client('C'), D = client('D');

await H.send('join_room', { roomId: 'ROOM22' });
const joined = H.last('room_joined').payload;
assert.equal(joined.you.role, 'host');
assert.equal(joined.settings.maxUsers, 4);
assert.equal(joined.pomodoro.phase, 'idle');
await A.send('join_room', { roomId: 'ROOM22' });
await B.send('join_room', { roomId: 'ROOM22' });
assert.equal(db.joins.length, 3);
assert.equal(rm.listPublicRooms()[0].participantCount, 3);

// chat saved to DB + broadcast + history
await A.send('chat_message', { message: 'hello' });
assert.equal(db.messages.length, 1);
assert.equal(H.last('chat_message').payload.message, 'hello');

// typing
await A.send('typing_start');
assert.equal(H.last('typing').payload.isTyping, true);
assert.equal(A.last('typing')?.payload.userId === 'A', false); // not echoed to sender

// reactions: whitelist + broadcast
await B.send('send_reaction', { emoji: '🔥' });
assert.equal(H.last('reaction').payload.emoji, '🔥');
A.clear(); await A.send('send_reaction', { emoji: '💩' });
assert.equal(A.last('error').payload.code, 'INVALID_PAYLOAD');

// playback permissions
await A.send('play');
assert.equal(A.last('error').payload.code, 'FORBIDDEN');
await H.send('change_video', { url: 'https://youtu.be/dQw4w9WgXcQ' });
assert.equal(B.last('sync_state').payload.videoId, 'dQw4w9WgXcQ');
assert.deepEqual(db.videoSaves, ['dQw4w9WgXcQ']);

// queue: add, reorder permission, vote skip (3 people -> need 2)
await A.send('queue_add', { url: 'dQw4w9WgXcR' });
await A.send('queue_add', { url: 'abcdefghijk' });
let q = H.last('queue_updated').payload;
assert.equal(q.queue.length, 2); assert.equal(q.skipNeeded, 2);
await A.send('queue_reorder', { itemId: q.queue[0].id, toIndex: 1 });
assert.equal(A.last('error').payload.code, 'FORBIDDEN');
await H.send('queue_reorder', { itemId: q.queue[0].id, toIndex: 1 });
q = H.last('queue_updated').payload;
assert.equal(q.queue[0].videoId, 'abcdefghijk');
await A.send('queue_vote_skip');
assert.equal(H.last('queue_updated').payload.skipVotes, 1);
await B.send('queue_vote_skip');
assert.equal(B.last('sync_state').payload.videoId, 'abcdefghijk'); // skipped to next
assert.equal(room.queue.length, 1);
assert.equal(room.skipVotes.size, 0);

// video ended: stale version ignored, host trusted
const v = room.playback.updatedAt;
await H.send('video_ended', { videoId: 'abcdefghijk', version: v - 1 });
assert.equal(room.playback.videoId, 'abcdefghijk');
await H.send('video_ended', { videoId: 'abcdefghijk', version: v });
assert.equal(room.playback.videoId, 'dQw4w9WgXcR'); // advanced from queue
// one participant alone cannot end the video (2 of 3 needed -> ceil(3/2)=2)
await A.send('video_ended', { videoId: 'dQw4w9WgXcR', version: room.playback.updatedAt });
assert.equal(room.playback.videoId, 'dQw4w9WgXcR');
await B.send('video_ended', { videoId: 'dQw4w9WgXcR', version: room.playback.updatedAt });
assert.equal(room.playback.isPlaying, false); // queue empty -> paused

// polls
await A.send('poll_create', { question: 'q', options: ['a', 'b'] });
assert.equal(A.last('error').payload.code, 'FORBIDDEN');
await H.send('poll_create', { question: 'Pick?', options: ['Yes', 'No', 'Yes'] });
let poll = A.last('poll_updated').payload.poll;
assert.equal(poll.options.length, 2);
await A.send('poll_vote', { pollId: poll.id, optionId: poll.options[0].id });
assert.equal(A.last('poll_updated').payload.myVote, poll.options[0].id);
assert.equal(H.last('poll_updated').payload.poll.total, 1);
assert.equal(H.last('poll_updated').payload.myVote, undefined);
await A.send('poll_vote', { pollId: poll.id, optionId: poll.options[1].id });
assert.equal(A.last('error').payload.code, 'POLL_ERROR');
await H.send('poll_close', { pollId: poll.id });
assert.equal(B.last('poll_updated').payload.poll.closed, true);

// notes (time from server)
await B.send('note_add', { text: 'cool part' });
assert.equal(H.last('note_added').payload.text, 'cool part');
await A.send('note_delete', { noteId: db.notes[0].id });
assert.equal(A.last('error').payload.code, 'FORBIDDEN');
await H.send('note_delete', { noteId: db.notes[0].id });
assert.equal(db.notes.length, 0);

// pomodoro
await A.send('pomodoro_start', { focusMin: 25, breakMin: 5 });
assert.equal(A.last('error').payload.code, 'FORBIDDEN');
await H.send('pomodoro_start', { focusMin: 25, breakMin: 5 });
assert.equal(B.last('pomodoro_state').payload.phase, 'focus');
await H.send('pomodoro_stop');
assert.equal(B.last('pomodoro_state').payload.phase, 'idle');

// WebRTC signalling + screen share
await H.send('rtc_join', { audio: true, video: true });
await A.send('rtc_join', { audio: true, video: false });
assert.equal(A.last('rtc_peers').payload.peers[0].userId, 'H');
assert.equal(H.last('rtc_peer_joined').payload.userId, 'A');
await A.send('rtc_offer', { to: 'H', description: { type: 'offer', sdp: 'x' } });
assert.equal(H.last('rtc_offer').payload.from, 'A');
await B.send('rtc_offer', { to: 'H', description: { type: 'offer', sdp: 'x' } }); // B not in call
assert.equal(B.last('error').payload.code, 'RTC_ERROR');
await H.send('screen_share_start', { streamId: 's1' });
assert.equal(A.last('screen_share_state').payload.screenShare.userId, 'H');
await A.send('screen_share_start', { streamId: 's2' });
assert.equal(A.last('error').payload.code, 'SCREEN_BUSY');
await H.send('rtc_leave');
assert.equal(A.last('screen_share_state').payload.screenShare, null);
assert.equal(A.last('rtc_peer_left').payload.userId, 'H');

// moderator permissions are per room
await H.send('assign_role', { userId: 'A', role: 'moderator' });
await A.send('pause'); // default: allowed (video is paused already -> still allowed, no error)
assert.notEqual(A.last('error')?.payload.code, 'FORBIDDEN');
await A.send('remove_participant', { userId: 'B' });
assert.equal(A.last('error').payload.code, 'FORBIDDEN'); // remove_participant off by default
room.updateSettings({ modPermissions: { control_playback: false, remove_participant: true } });
assert.equal(A.last('room_settings_updated').payload.settings.modPermissions.control_playback, false);
await A.send('play');
assert.equal(A.last('error').payload.code, 'FORBIDDEN');
await A.send('request_play'); // now a mod without playback rights may ask like a participant
assert.equal(A.last('request_ack').payload.type, 'play');
assert.equal(H.last('request_created').payload.username, 'user-A');
await H.send('approve_request', { requestId: H.last('request_created').payload.id });
assert.equal(room.playback.isPlaying, true);

// max users: room has H,A,B (3) of 4 -> C joins, D is rejected
await C.send('join_room', { roomId: 'ROOM22' });
await D.send('join_room', { roomId: 'ROOM22' });
assert.equal(D.last('error').payload.code, 'ROOM_FULL');
assert.equal(D.ws.closed, 4006);

// mod can remove participants once enabled, but not the host
await A.send('remove_participant', { userId: 'B' });
assert.equal(B.last('removed_from_room').payload.roomId, 'ROOM22');
await A.send('remove_participant', { userId: 'H' });
assert.equal(A.last('error').payload.code, 'FORBIDDEN');
assert.ok(db.leaves.length >= 1);

// password gating state
room.updateSettings({ passwordHash: 'x' });
assert.equal(room.needsPassword('Z'), true);
assert.equal(room.needsPassword('A'), false); // already inside
console.log('ALL SMOKE TESTS PASSED');
process.exit(0);
