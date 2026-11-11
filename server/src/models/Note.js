import mongoose from 'mongoose';

const noteSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    text: { type: String, required: true, maxlength: 300 },
    videoId: { type: String, default: null },
    videoTime: { type: Number, required: true, min: 0 }, // seconds into the video
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

noteSchema.index({ roomId: 1, createdAt: 1 });

export default mongoose.model('Note', noteSchema);
