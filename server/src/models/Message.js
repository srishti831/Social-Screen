import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true }, // the 6-character room code
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    text: { type: String, required: true, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

messageSchema.index({ roomId: 1, _id: -1 }); // newest first + cursor pagination
messageSchema.index({ userId: 1, createdAt: -1 }); // personal stats

export default mongoose.model('Message', messageSchema);
