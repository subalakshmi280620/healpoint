import { Router } from 'express';
import { getMe, login, logout, register, updateMe } from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';
import { createAuthRateLimiters } from '../middleware/authRateLimit.js';

const createAuthRouter = (rateLimiters = createAuthRateLimiters()) => {
  const router = Router();

  router.post('/register/', rateLimiters.register, register);
  router.post('/login/', rateLimiters.login, login);
  router.post('/logout/', protect, logout);
  router.get('/me/', protect, getMe);
  router.patch('/me/', protect, updateMe);

  return router;
};

export default createAuthRouter;
