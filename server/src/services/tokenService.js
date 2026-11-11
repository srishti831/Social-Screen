import RefreshToken from '../models/RefreshToken.js';
import { env } from '../config/env.js';
import { randomToken, sha256 } from '../utils/token.js';

const expiryDate = () => new Date(Date.now() + env.refreshDays * 24 * 60 * 60 * 1000);

/** Creates a refresh token. The raw value goes to the cookie; only its hash is stored. */
export async function issueRefreshToken(userId, userAgent = '') {
  const raw = randomToken();
  await RefreshToken.create({
    userId,
    tokenHash: sha256(raw),
    userAgent: String(userAgent).slice(0, 200),
    expiresAt: expiryDate(),
  });
  return raw;
}

/**
 * Rotation: a refresh token works exactly once. Returns the user id and a brand-new token,
 * or null if the token is unknown/expired/already used.
 */
export async function rotateRefreshToken(raw, userAgent = '') {
  if (typeof raw !== 'string' || !raw) return null;
  const doc = await RefreshToken.findOneAndDelete({ tokenHash: sha256(raw) });
  if (!doc || doc.expiresAt < new Date()) return null;
  const refreshToken = await issueRefreshToken(doc.userId, userAgent);
  return { userId: String(doc.userId), refreshToken };
}

export async function revokeRefreshToken(raw) {
  if (typeof raw !== 'string' || !raw) return;
  await RefreshToken.deleteOne({ tokenHash: sha256(raw) });
}

export const revokeAllForUser = (userId) => RefreshToken.deleteMany({ userId });
