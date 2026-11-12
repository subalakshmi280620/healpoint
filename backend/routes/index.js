import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import createAuthRouter from './authRoutes.js';
import clinicRoutes from './clinicRoutes.js';
import doctorRoutes from './doctorRoutes.js';
import appointmentRoutes from './appointmentRoutes.js';
import adminRoutes from './adminRoutes.js';
import notificationRoutes from './notificationRoutes.js';

const createApiRouter = ({ authRateLimiters } = {}) => {
  const router = Router();

  router.use(healthRoutes);
  router.use('/auth', createAuthRouter(authRateLimiters));
  router.use('/clinics', clinicRoutes);
  router.use('/doctors', doctorRoutes);
  router.use('/appointments', appointmentRoutes);
  router.use('/admin', adminRoutes);
  router.use('/notifications', notificationRoutes);

  return router;
};

export default createApiRouter;
