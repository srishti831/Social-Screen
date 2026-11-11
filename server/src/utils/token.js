import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const signAccessToken = (userId) =>
  jwt.sign({ sub: String(userId) }, env.jwtSecret, { expiresIn: env.accessExpire });

/** Returns the user id stored in the token, or null if invalid/expired. */
export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.jwtSecret).sub;
  } catch {
    return null;
  }
}

/** Random opaque token (refresh / email verify / password reset). Only its hash is stored. */
export const randomToken = () => randomBytes(32).toString('hex');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
