import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';

const limiter = (windowMs, limit) =>
  rateLimit({
    windowMs,
    limit: env.nodeEnv === 'test' ? 10_000 : limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later' },
  });

export function createAuthRoutes(controller) {
  const router = Router();
  const credentials = limiter(15 * 60 * 1000, 40); // login / register / google / reset: brute-force protection
  const emails = limiter(60 * 60 * 1000, 10); // anything that sends an email
  const tickets = limiter(60 * 1000, 60); // also slows down room-password guessing

  router.post('/register', credentials, controller.register);
  router.post('/login', credentials, controller.login);
  router.post('/google', credentials, controller.google);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.get('/me', requireAuth, controller.me);

  router.post('/verify-email', credentials, controller.verifyEmail);
  router.post('/resend-verification', requireAuth, emails, controller.resendVerification);
  router.post('/forgot-password', emails, controller.forgotPassword);
  router.post('/reset-password', credentials, controller.resetPassword);

  router.post('/ws-ticket', requireAuth, tickets, controller.createWsTicket);
  return router;
}
