import { AppError } from '../utils/errors.js';
import { verifyAccessToken } from '../utils/token.js';
import { ACCESS_COOKIE } from '../utils/cookies.js';
import { findUserById } from '../services/userService.js';

/**
 * The JWT normally arrives in an httpOnly cookie. A Bearer header is also accepted so tools
 * like Postman or curl can call the API without a browser.
 */
export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = req.cookies?.[ACCESS_COOKIE] || (header.startsWith('Bearer ') ? header.slice(7) : null);
  const userId = token && verifyAccessToken(token);
  if (!userId) throw new AppError('Authentication required', 401);

  const user = await findUserById(userId);
  if (!user) throw new AppError('Authentication required', 401);

  req.user = { id: String(user._id), name: user.name, email: user.email, emailVerified: user.emailVerified };
  next();
}
