import mongoose from 'mongoose';
import { DEFAULT_MOD_PERMISSIONS } from '../websocket/constants.js';

const ROOM_TTL_SECONDS = 7 * 24 * 60 * 60;

const queueItemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    videoId: { type: String, required: true },
    title: { type: String, default: null },
    addedBy: { type: String, required: true },
    addedByName: { type: String, default: '' },
  },
  { _id: false }
);

const roomSchema = new mongoose.Schema(
  {
    roomCode: { type: String, required: true, unique: true },
    hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, default: '', maxlength: 60 },
    isPublic: { type: Boolean, default: false },
    passwordHash: { type: String, default: null }, // bcrypt; null = no password
    maxUsers: { type: Number, default: 10, min: 2, max: 50 },
    modPermissions: { type: Object, default: () => ({ ...DEFAULT_MOD_PERMISSIONS }) },
    queue: { type: [queueItemSchema], default: [] },
    currentVideoId: { type: String, default: null },
    isPlaying: { type: Boolean, default: false },
    currentTime: { type: Number, default: 0 },
    // Rooms nobody touched for 7 days are deleted automatically by MongoDB (TTL index).
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true, minimize: false }
);

roomSchema.index({ lastActiveAt: 1 }, { expireAfterSeconds: ROOM_TTL_SECONDS });

export default mongoose.model('Room', roomSchema);
