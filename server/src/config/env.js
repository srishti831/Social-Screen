import dotenv from 'dotenv';

dotenv.config();

const stripSlash = (url) => (url || '').replace(/\/+$/, '');

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI,
  clientUrl: stripSlash(process.env.CLIENT_URL || 'http://localhost:5173'),
  jwtSecret: process.env.JWT_SECRET,
  accessExpire: process.env.ACCESS_TOKEN_EXPIRE || '15m',
  refreshDays: Number(process.env.REFRESH_TOKEN_DAYS) || 30,
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 10,
  cookieSameSite: (process.env.COOKIE_SAMESITE || 'lax').toLowerCase(),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Social - Screen <no-reply@social-screen.local>',
  },
  requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === 'true',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
};

export const isProd = env.nodeEnv === 'production';

/** Origins allowed for CORS and for the WebSocket upgrade request. */
export function allowedOrigins() {
  const list = [env.clientUrl];
  if (!isProd) list.push('http://localhost:5173', 'http://127.0.0.1:5173');
  return list;
}

export function validateEnv() {
  const missing = ['MONGODB_URI', 'JWT_SECRET'].filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}
