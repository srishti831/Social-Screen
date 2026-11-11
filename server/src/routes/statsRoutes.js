import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { statsController } from '../controllers/statsController.js';

export function createStatsRoutes() {
  const router = Router();
  router.get('/me', requireAuth, statsController.me);
  return router;
}
