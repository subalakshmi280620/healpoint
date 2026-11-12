import { Router } from 'express';
import {
  createClinic,
  getClinicById,
  getClinics,
  updateClinic,
} from '../controllers/clinicController.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorizeRoles, rejectRoleAssignment } from '../middleware/roleMiddleware.js';

const router = Router();

router.get('/', getClinics);
router.get('/:id', getClinicById);
router.post(
  '/',
  protect,
  authorizeRoles('clinic_admin', 'platform_admin'),
  rejectRoleAssignment,
  createClinic
);
router.put(
  '/:id',
  protect,
  authorizeRoles('clinic_admin', 'platform_admin'),
  rejectRoleAssignment,
  updateClinic
);

export default router;
