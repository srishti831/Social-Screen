import mongoose from 'mongoose';

// One document per (user, room): powers "My rooms + history" and the personal stats page.
const roomJoinSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    roomCode: { type: String, required: true },
    lastJoinedAt: { type: Date, default: Date.now },
    joinCount: { type: Number, default: 0 },
    totalSeconds: { type: Number, default: 0 }, // time spent inside the room
  },
  { timestamps: true }
);

roomJoinSchema.index({ userId: 1, roomCode: 1 }, { unique: true });
roomJoinSchema.index({ userId: 1, lastJoinedAt: -1 });

export default mongoose.model('RoomJoin', roomJoinSchema);
