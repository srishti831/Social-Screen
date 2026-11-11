import { persistence } from '../services/persistence.js';

export const statsController = {
  async me(req, res) {
    res.json({ success: true, stats: await persistence.getUserStats(req.user.id) });
  },
};
