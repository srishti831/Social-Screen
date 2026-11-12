import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { randomToken, sha256, signAccessToken } from '../utils/token.js';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from '../utils/cookies.js';
import { normalizeRoomCode } from '../utils/roomCode.js';
import User from '../models/User.js';
import { createUser, findUserByEmail, findUserByGoogleId, findUserById, toPublicUser } from '../services/userService.js';
import { issueRefreshToken, revokeAllForUser, revokeRefreshToken, rotateRefreshToken } from '../services/tokenService.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../services/mailService.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR = 60 * 60 * 1000;

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) {
    throw new AppError('Password must be 8-100 characters', 400);
  }
}

export function createAuthController({ ticketService, roomManager }) {
  const googleClient = env.googleClientId ? new OAuth2Client(env.googleClientId) : null;

  /** Short-lived access token + long-lived refresh token, both as httpOnly cookies. */
  async function startSession(req, res, user) {
    const accessToken = signAccessToken(user._id);
    const refreshToken = await issueRefreshToken(user._id, req.get('user-agent'));
    setAuthCookies(res, { accessToken, refreshToken });
  }

  /** Stores only the hash of a random token; the raw token goes into the email link. */
  async function createEmailToken(user, field, ttlMs) {
    const raw = randomToken();
    user[`${field}TokenHash`] = sha256(raw);
    user[`${field}Expires`] = new Date(Date.now() + ttlMs);
    await user.save();
    return raw;
  }

  return {
    async register(req, res) {
      const { name, email, password } = req.body || {};
      if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 50) {
        throw new AppError('Name must be 2-50 characters', 400);
      }
      if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) throw new AppError('A valid email is required', 400);
      validatePassword(password);

      const normalizedEmail = email.trim().toLowerCase();
      if (await findUserByEmail(normalizedEmail)) throw new AppError('Email is already registered', 409);

      const passwordHash = await bcrypt.hash(password, env.bcryptRounds);
      const user = await createUser({ name: name.trim(), email: normalizedEmail, passwordHash });
      const token =  await createEmailToken(user, 'verify', 24 * HOUR);
      sendVerificationEmail(user, token);

      await startSession(req, res, user);
      res.status(201).json({ success: true, user: toPublicUser(user) });
    },

    async login(req, res) {
      const { email, password } = req.body || {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        throw new AppError('Email and password are required', 400);
      }
      const user = await findUserByEmail(email.trim().toLowerCase());
      if (user && !user.password) throw new AppError('This account uses Google sign-in. Use the Google button.', 400);
      // Same message for unknown email and wrong password so emails can't be probed.
      const valid = user && (await bcrypt.compare(password, user.password));
      if (!valid) throw new AppError('Invalid email or password', 401);
      if (env.requireEmailVerification && !user.emailVerified) {
        throw new AppError('Please verify your email first. Check your inbox.', 403, 'EMAIL_NOT_VERIFIED');
      }

      await startSession(req, res, user);
      res.json({ success: true, user: toPublicUser(user) });
    },

    /** Swaps a valid refresh token for a new access token + a new refresh token (rotation). */
    async refresh(req, res) {
      const result = await rotateRefreshToken(req.cookies?.[REFRESH_COOKIE], req.get('user-agent'));
      const user = result && (await findUserById(result.userId));
      if (!user) {
        clearAuthCookies(res);
        throw new AppError('Session expired, please log in again', 401);
      }
      setAuthCookies(res, { accessToken: signAccessToken(user._id), refreshToken: result.refreshToken });
      res.json({ success: true, user: toPublicUser(user) });
    },

    // Logging out deletes the refresh token from the database, so it can never be used again.
    async logout(req, res) {
      await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
      clearAuthCookies(res);
      res.json({ success: true, message: 'Logged out' });
    },

    async me(req, res) {
      const user = await findUserById(req.user.id);
      res.json({ success: true, user: toPublicUser(user) });
    },

    async verifyEmail(req, res) {
      const token = req.body?.token;
      if (typeof token !== 'string' || !token) throw new AppError('Verification token is required', 400);
      const user = await User.findOne({ verifyTokenHash: sha256(token) });
      if (!user || !user.verifyExpires || user.verifyExpires < new Date()) {
        throw new AppError('This verification link is invalid or has expired', 400);
      }
      user.emailVerified = true;
      user.verifyTokenHash = null;
      user.verifyExpires = null;
      await user.save();
      res.json({ success: true, message: 'Email verified' });
    },

    async resendVerification(req, res) {
      const user = await findUserById(req.user.id);
      if (user.emailVerified) return res.json({ success: true, message: 'Already verified' });
      const token = await createEmailToken(user, 'verify', 24 * HOUR);
      sendVerificationEmail(user, token);
      return res.json({ success: true, message: 'Verification email sent' });
    },

    // Always answers the same, so nobody can use this form to find out which emails exist.
    async forgotPassword(req, res) {
      const email = req.body?.email;
      if (typeof email === 'string' && EMAIL_RE.test(email.trim())) {
        const user = await findUserByEmail(email.trim().toLowerCase());
        if (user) {
          const token = await createEmailToken(user, 'reset', HOUR);
          sendPasswordResetEmail(user, token);
        }
      }
      res.json({ success: true, message: 'If that email is registered, a reset link is on its way.' });
    },

    async resetPassword(req, res) {
      const { token, password } = req.body || {};
      if (typeof token !== 'string' || !token) throw new AppError('Reset token is required', 400);
      validatePassword(password);
      const user = await User.findOne({ resetTokenHash: sha256(token) });
      if (!user || !user.resetExpires || user.resetExpires < new Date()) {
        throw new AppError('This reset link is invalid or has expired', 400);
      }
      user.password = await bcrypt.hash(password, env.bcryptRounds);
      user.resetTokenHash = null;
      user.resetExpires = null;
      user.emailVerified = true; // they proved they own the inbox
      await user.save();
      await revokeAllForUser(user._id); // log out everywhere
      res.json({ success: true, message: 'Password updated. You can log in now.' });
    },

    async google(req, res) {
      if (!googleClient) throw new AppError('Google sign-in is not configured', 501);
      const credential = req.body?.credential;
      if (typeof credential !== 'string' || !credential) throw new AppError('Google credential is required', 400);

      let payload;
      try {
        const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.googleClientId });
        payload = ticket.getPayload();
      } catch {
        throw new AppError('Google sign-in failed', 401);
      }
      if (!payload?.email || !payload.email_verified) throw new AppError('Your Google email is not verified', 400);

      const email = payload.email.toLowerCase();
      let user = (await findUserByGoogleId(payload.sub)) || (await findUserByEmail(email));
      if (!user) {
        user = await createUser({ name: (payload.name || email.split('@')[0]).slice(0, 50), email, googleId: payload.sub, emailVerified: true });
      } else if (!user.googleId) {
        user.googleId = payload.sub; // link Google to the existing email account
        user.emailVerified = true;
        await user.save();
      }

      await startSession(req, res, user);
      res.json({ success: true, user: toPublicUser(user) });
    },

    async createWsTicket(req, res) {
      const roomId = normalizeRoomCode(req.body?.roomId);
      if (!roomId) throw new AppError('A valid roomId is required', 400);

      const room = await roomManager.getOrLoadRoom(roomId);
      if (!room) throw new AppError('Room not found', 404);
      const userId = req.user.id;
      if (room.isKicked(userId)) throw new AppError('You were removed from this room', 403, 'REMOVED');
      if (room.isFull(userId)) throw new AppError('This room is full', 403, 'ROOM_FULL');

      if (room.needsPassword(userId)) {
        const password = req.body?.password;
        if (typeof password !== 'string' || !password) throw new AppError('This room is password protected', 403, 'PASSWORD_REQUIRED');
        if (!(await bcrypt.compare(password, room.settings.passwordHash))) {
          throw new AppError('Wrong room password', 403, 'WRONG_PASSWORD');
        }
        room.allowed.add(userId); // remembered while the room is loaded, so reconnects don't ask again
      }

      const ticket = ticketService.issue({ userId, username: req.user.name, roomId });
      res.json({ success: true, ticket, expiresIn: Math.round(ticketService.ttlMs / 1000) });
    },
  };
}
