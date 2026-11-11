import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // bcrypt hash. Empty for accounts that only ever used Google sign-in.
    password: { type: String, default: null },
    // No default on purpose: a sparse unique index would treat many `null`s as duplicates.
    googleId: { type: String, index: { unique: true, sparse: true } },
    emailVerified: { type: Boolean, default: false },
    // Only SHA-256 hashes of the emailed tokens are stored.
    verifyTokenHash: { type: String, default: null },
    verifyExpires: { type: Date, default: null },
    resetTokenHash: { type: String, default: null },
    resetExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
