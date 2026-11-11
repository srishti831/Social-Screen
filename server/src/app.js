import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { allowedOrigins } from './config/env.js';
import { AppError } from './utils/errors.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { createAuthController } from './controllers/authController.js';
import { createRoomController } from './controllers/roomController.js';
import { createAuthRoutes } from './routes/authRoutes.js';
import { createRoomRoutes } from './routes/roomRoutes.js';
import { createStatsRoutes } from './routes/statsRoutes.js';

/** Builds the Express app. Kept separate from index.js so tests can use it without listening. */
export function createApp({ roomManager, ticketService }) {
  const app = express();
  app.set('trust proxy', 1); // Render sits behind a proxy; needed for correct client IPs

  app.use(helmet());
  app.use(
    cors({
      // Cookies only travel to origins we list (never "*"), and only with credentials: true.
      origin(origin, callback) {
        // No Origin header = non-browser client (curl, Postman, health checks).
        if (!origin || allowedOrigins().includes(origin)) return callback(null, true);
        return callback(new AppError('Origin not allowed', 403));
      },
      credentials: true,
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '10kb' })); // only JSON bodies are parsed, so plain HTML form posts (CSRF) carry nothing

  app.get('/', (_req, res) => res.json({ success: true, message: 'Social - Screen API' }));
  app.get('/api/health', (_req, res) => res.json({ success: true, message: 'Server is running' }));

  app.use('/api/auth', createAuthRoutes(createAuthController({ ticketService, roomManager })));
  app.use('/api/rooms', createRoomRoutes(createRoomController({ roomManager })));
  app.use('/api/stats', createStatsRoutes());

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
