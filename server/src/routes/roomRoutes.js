import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export function createRoomRoutes(controller) {
  const router = Router();
  router.use(requireAuth);
  router.get('/public', controller.publicRooms); // must stay above '/:roomId'
  router.get('/mine', controller.mine);
  router.post('/', controller.create);
  router.get('/:roomId', controller.get);
  router.patch('/:roomId', controller.update);
  router.delete('/:roomId', controller.remove);
  router.get('/:roomId/messages', controller.messages);
  return router;
}
