import { env, isProd } from '../config/env.js';

export const ACCESS_COOKIE = 'wp_access';
export const REFRESH_COOKIE = 'wp_refresh';

function baseOptions() {
  const sameSite = ['lax', 'strict', 'none'].includes(env.cookieSameSite) ? env.cookieSameSite : 'lax';
  return {
    httpOnly: true, // JavaScript can never read these cookies (protects against XSS token theft)
    secure: isProd || sameSite === 'none', // SameSite=None requires Secure
    sameSite,
  };
}

export function setAuthCookies(res, { accessToken, refreshToken }) {
  const base = baseOptions();
  res.cookie(ACCESS_COOKIE, accessToken, { ...base, path: '/', maxAge: 15 * 60 * 1000 });
  // The refresh cookie is only sent to /api/auth/*, never to the rest of the API.
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...base,
    path: '/api/auth',
    maxAge: env.refreshDays * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res) {
  const base = baseOptions();
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: '/api/auth' });
}
