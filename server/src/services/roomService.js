import Room from '../models/Room.js';
import { DEFAULT_MOD_PERMISSIONS } from '../websocket/constants.js';

/** Plain object used everywhere in the app (never the Mongoose document). */
const toPlain = (doc) =>
  doc && {
    roomId: doc.roomCode,
    hostId: String(doc.hostId),
    name: doc.name || '',
    isPublic: Boolean(doc.isPublic),
    passwordHash: doc.passwordHash || null,
    maxUsers: doc.maxUsers ?? 10,
    modPermissions: { ...DEFAULT_MOD_PERMISSIONS, ...(doc.modPermissions || {}) },
    queue: (doc.queue || []).map((q) => ({
      id: q.id,
      videoId: q.videoId,
      title: q.title ?? null,
      addedBy: q.addedBy,
      addedByName: q.addedByName,
    })),
    videoId: doc.currentVideoId ?? null,
    currentTime: doc.currentTime ?? 0,
    createdAt: doc.createdAt,
  };

export async function findRoom(roomCode) {
  return toPlain(await Room.findOne({ roomCode }).lean());
}

export async function findRooms(roomCodes) {
  return (await Room.find({ roomCode: { $in: roomCodes } }).lean()).map(toPlain);
}

export async function createRoomRecord({ roomCode, hostId, name, isPublic, passwordHash, maxUsers, modPermissions }) {
  return toPlain(await Room.create({ roomCode, hostId, name, isPublic, passwordHash, maxUsers, modPermissions }));
}

export const deleteRoomRecord = (roomCode) => Room.deleteOne({ roomCode });

export async function listRoomsByHost(hostId) {
  const docs = await Room.find({ hostId }).sort({ createdAt: -1 }).limit(30).lean();
  return docs.map(toPlain);
}

export const countRoomsByHost = (hostId) => Room.countDocuments({ hostId });

// Persistence is deliberately sparse: room create, settings, queue, video change, host change,
// and when an empty room is unloaded from memory. Never on play/pause/seek.
export const saveVideo = (roomCode, videoId) =>
  Room.updateOne(
    { roomCode },
    { $set: { currentVideoId: videoId, currentTime: 0, isPlaying: false, lastActiveAt: new Date() } }
  );

export const saveHost = (roomCode, hostId) =>
  Room.updateOne({ roomCode }, { $set: { hostId, lastActiveAt: new Date() } });

export const saveQueue = (roomCode, queue) =>
  Room.updateOne({ roomCode }, { $set: { queue, lastActiveAt: new Date() } });

export const saveSettings = (roomCode, settings) =>
  Room.updateOne({ roomCode }, { $set: { ...settings, lastActiveAt: new Date() } });

export const saveSnapshot = (roomCode, { videoId, currentTime, hostId }) =>
  Room.updateOne(
    { roomCode },
    { $set: { currentVideoId: videoId, currentTime, isPlaying: false, hostId, lastActiveAt: new Date() } }
  );
