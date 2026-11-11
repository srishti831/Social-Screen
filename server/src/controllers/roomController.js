import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { generateRoomCode, normalizeRoomCode } from '../utils/roomCode.js';
import { DEFAULT_MOD_PERMISSIONS, sanitizeModPermissions } from '../websocket/constants.js';
import { persistence } from '../services/persistence.js';

/**
 * Validates room settings from a request body. Only keys that are present are returned, so the
 * same function serves "create" (defaults filled in later) and "update" (partial patch).
 */
async function parseSettings(body = {}, currentModPermissions = DEFAULT_MOD_PERMISSIONS) {
  const patch = {};
  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.trim().length > 60) throw new AppError('Room name must be at most 60 characters', 400);
    patch.name = body.name.trim();
  }
  if ('isPublic' in body) {
    if (typeof body.isPublic !== 'boolean') throw new AppError('isPublic must be true or false', 400);
    patch.isPublic = body.isPublic;
  }
  if ('maxUsers' in body) {
    const n = Number(body.maxUsers);
    if (!Number.isInteger(n) || n < 2 || n > 50) throw new AppError('Max users must be a whole number from 2 to 50', 400);
    patch.maxUsers = n;
  }
  if ('modPermissions' in body) {
    if (typeof body.modPermissions !== 'object' || body.modPermissions === null) throw new AppError('modPermissions must be an object', 400);
    patch.modPermissions = sanitizeModPermissions(body.modPermissions, currentModPermissions);
  }
  if ('password' in body) {
    if (body.password === null || body.password === '') {
      patch.passwordHash = null; // remove the password
    } else if (typeof body.password === 'string' && body.password.length >= 4 && body.password.length <= 50) {
      patch.passwordHash = await bcrypt.hash(body.password, env.bcryptRounds);
    } else {
      throw new AppError('Room password must be 4-50 characters', 400);
    }
  }
  return patch;
}

export function createRoomController({ roomManager }) {
  const codeFrom = (req) => {
    const roomId = normalizeRoomCode(req.params.roomId);
    if (!roomId) throw new AppError('Invalid room code', 400);
    return roomId;
  };

  return {
    async create(req, res) {
      const settings = await parseSettings(req.body || {});

      // Retry on the (very unlikely) collision with an existing code.
      let code;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = generateRoomCode();
        if (!roomManager.getRoom(candidate) && !(await persistence.findRoom(candidate))) {
          code = candidate;
          break;
        }
      }
      if (!code) throw new AppError('Could not generate a room code, try again', 500);

      const record = await persistence.createRoomRecord({ roomCode: code, hostId: req.user.id, ...settings });
      roomManager.createRoom({ roomId: record.roomId, hostId: record.hostId, settings: record, queue: [] });
      res.status(201).json({ success: true, room: { roomId: record.roomId, hostId: record.hostId } });
    },

    async get(req, res) {
      const roomId = codeFrom(req);
      const room = await roomManager.getOrLoadRoom(roomId);
      if (!room) throw new AppError('Room not found', 404);
      res.json({
        success: true,
        room: {
          roomId,
          hostId: room.hostId,
          videoId: room.playback.videoId,
          participantCount: room.participants.size,
          ...room.publicSettings(),
        },
      });
    },

    // Host only. The in-memory room is updated live and everyone inside is told.
    async update(req, res) {
      const roomId = codeFrom(req);
      const room = await roomManager.getOrLoadRoom(roomId);
      if (!room) throw new AppError('Room not found', 404);
      if (room.hostId !== req.user.id) throw new AppError('Only the host can change room settings', 403);

      const patch = await parseSettings(req.body || {}, room.settings.modPermissions);
      if (Object.keys(patch).length === 0) throw new AppError('Nothing to update', 400);

      await persistence.saveSettings(roomId, patch);
      room.updateSettings(patch);
      res.json({ success: true, settings: room.publicSettings() });
    },

    // Only the CURRENT host may delete. Everyone inside is told and disconnected.
    async remove(req, res) {
      const roomId = codeFrom(req);
      const room = await roomManager.getOrLoadRoom(roomId);
      if (!room) throw new AppError('Room not found', 404);
      if (room.hostId !== req.user.id) throw new AppError('Only the host can delete this room', 403);

      await persistence.deleteRoomRecord(roomId);
      roomManager.closeRoom(roomId, 'The host closed this room.');
      await persistence.purgeRoomData(roomId); // messages, notes, history
      res.json({ success: true, message: 'Room deleted' });
    },

    /** Active public rooms (someone is inside right now). */
    publicRooms(_req, res) {
      res.json({ success: true, rooms: roomManager.listPublicRooms() });
    },

    /** Dashboard: rooms I host + rooms I visited recently. */
    async mine(req, res) {
      const [hosted, recent] = await Promise.all([
        persistence.listRoomsByHost(req.user.id),
        persistence.listRecentRooms(req.user.id),
      ]);
      res.json({
        success: true,
        hosted: hosted.map((r) => ({
          roomId: r.roomId,
          name: r.name,
          videoId: r.videoId,
          isPublic: r.isPublic,
          hasPassword: Boolean(r.passwordHash),
          createdAt: r.createdAt,
        })),
        recent,
      });
    },

    /** Older chat messages for the "load more" button. Only people who have been in the room may read them. */
    async messages(req, res) {
      const roomId = codeFrom(req);
      const room = await roomManager.getOrLoadRoom(roomId);
      if (!room) throw new AppError('Room not found', 404);
      const allowed = room.hostId === req.user.id || room.participants.has(req.user.id) || (await persistence.hasJoined(req.user.id, roomId));
      if (!allowed) throw new AppError('Join the room to read its messages', 403);

      const messages = await persistence.getMessages(roomId, { before: req.query.before, limit: req.query.limit });
      res.json({ success: true, messages });
    },
  };
}
