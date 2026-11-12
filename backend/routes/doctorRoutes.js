import { Router } from 'express';
import {
  createDoctor,
  getDoctorById,
  getDoctors,
  getMyDoctorProfile,
  getSpecialties,
  updateDoctor,
} from '../controllers/doctorController.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorizeRoles, rejectRoleAssignment } from '../middleware/roleMiddleware.js';

const router = Router();

router.get('/', getDoctors);
router.get('/specialties', getSpecialties);
router.get('/me', protect, authorizeRoles('doctor'), getMyDoctorProfile);
router.get('/:id', getDoctorById);
router.post(
  '/',
  protect,
  authorizeRoles('doctor', 'clinic_admin', 'platform_admin'),
  rejectRoleAssignment,
  createDoctor
);
router.put(
  '/:id',
  protect,
  authorizeRoles('doctor', 'clinic_admin', 'platform_admin'),
  rejectRoleAssignment,
  updateDoctor
);

export default router;
