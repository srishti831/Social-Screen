import mongoose from 'mongoose';
import RoomJoin from '../models/RoomJoin.js';
import Room from '../models/Room.js';
import Message from '../models/Message.js';
import Note from '../models/Note.js';
import { findRooms } from './roomService.js';

const oid = (id) => new mongoose.Types.ObjectId(String(id));

export const recordJoin = (userId, roomCode) =>
  RoomJoin.updateOne(
    { userId, roomCode },
    { $set: { lastJoinedAt: new Date() }, $inc: { joinCount: 1 } },
    { upsert: true }
  );

export const recordLeave = (userId, roomCode, seconds) =>
  RoomJoin.updateOne({ userId, roomCode }, { $inc: { totalSeconds: Math.max(0, Math.round(seconds)) } });

export const hasJoined = async (userId, roomCode) => Boolean(await RoomJoin.exists({ userId, roomCode }));

/** Rooms the user visited recently (that still exist), newest first. */
export async function listRecentRooms(userId, limit = 20) {
  const joins = await RoomJoin.find({ userId }).sort({ lastJoinedAt: -1 }).limit(limit).lean();
  const rooms = await findRooms(joins.map((j) => j.roomCode));
  const byCode = new Map(rooms.map((r) => [r.roomId, r]));
  return joins
    .filter((j) => byCode.has(j.roomCode))
    .map((j) => {
      const room = byCode.get(j.roomCode);
      return {
        roomId: j.roomCode,
        name: room.name,
        videoId: room.videoId,
        isPublic: room.isPublic,
        hasPassword: Boolean(room.passwordHash),
        isHost: room.hostId === String(userId),
        lastJoinedAt: j.lastJoinedAt,
        joinCount: j.joinCount,
        totalSeconds: j.totalSeconds,
      };
    });
}

/** Called when a host deletes a room: remove everything that belonged to it. */
export async function purgeRoomData(roomCode) {
  await Promise.all([
    Message.deleteMany({ roomId: roomCode }),
    Note.deleteMany({ roomId: roomCode }),
    RoomJoin.deleteMany({ roomCode }),
  ]);
}

// ---------- personal stats (MongoDB aggregation) ----------

const DAYS = 14;

export async function getUserStats(userId) {
  const uid = oid(userId);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (DAYS - 1));

  const [totals, perDay, topChatRooms, topWatchRooms, roomsHosted, notes] = await Promise.all([
    RoomJoin.aggregate([
      { $match: { userId: uid } },
      { $group: { _id: null, rooms: { $sum: 1 }, joins: { $sum: '$joinCount' }, seconds: { $sum: '$totalSeconds' } } },
    ]),
    Message.aggregate([
      { $match: { userId: uid, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
    ]),
    Message.aggregate([
      { $match: { userId: uid } },
      { $group: { _id: '$roomId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
    RoomJoin.find({ userId: uid }).sort({ totalSeconds: -1 }).limit(5).lean(),
    Room.countDocuments({ hostId: uid }),
    Note.countDocuments({ userId: uid }),
  ]);

  const countByDay = new Map(perDay.map((d) => [d._id, d.count]));
  const messagesPerDay = [];
  for (let i = 0; i < DAYS; i += 1) {
    const day = new Date(since);
    day.setUTCDate(since.getUTCDate() + i);
    const key = day.toISOString().slice(0, 10);
    messagesPerDay.push({ date: key, count: countByDay.get(key) || 0 });
  }

  const t = totals[0] || { rooms: 0, joins: 0, seconds: 0 };
  const totalMessages = await Message.countDocuments({ userId: uid });
  return {
    totalMessages,
    roomsVisited: t.rooms,
    totalJoins: t.joins,
    watchMinutes: Math.round(t.seconds / 60),
    roomsHosted,
    notes,
    messagesPerDay,
    topChatRooms: topChatRooms.map((r) => ({ roomId: r._id, count: r.count })),
    topWatchRooms: topWatchRooms.map((r) => ({ roomId: r.roomCode, minutes: Math.round(r.totalSeconds / 60) })),
  };
}
