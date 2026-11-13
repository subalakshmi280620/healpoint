import { Router } from 'express';
import {
  getAdminAppointments,
  getAdminClinics,
  getAdminDashboardStats,
  getAdminDoctorCandidates,
  getAdminDoctors,
  getAdminSpecialties,
  getAdminUsers,
  createAdminDoctorAccount,
  createAdminClinicAdmin,
  getAdminClinicAdmins,
  resetAdminClinicAdminPassword,
  updateAdminClinicAdminStatus,
  updateAdminAppointmentStatus,
  updateAdminUserStatus,
  createAdminSpecialty,
} from '../controllers/adminController.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorizeRoles } from '../middleware/roleMiddleware.js';

const router = Router();

router.use(protect, authorizeRoles('platform_admin', 'clinic_admin'));
router.get('/dashboard/stats', getAdminDashboardStats);
router.get('/clinics', getAdminClinics);
router.get('/doctors', getAdminDoctors);
router.get('/doctor-candidates', getAdminDoctorCandidates);
router.post('/doctor-accounts', createAdminDoctorAccount);
router.get('/specialties', getAdminSpecialties);
router.post('/specialties', authorizeRoles('platform_admin'), createAdminSpecialty);
router.get('/users', getAdminUsers);
router.patch('/users/:id/status', authorizeRoles('platform_admin'), updateAdminUserStatus);
router.get('/clinic-admins', authorizeRoles('platform_admin'), getAdminClinicAdmins);
router.post('/clinic-admins', authorizeRoles('platform_admin'), createAdminClinicAdmin);
router.patch('/clinic-admins/:id/password', authorizeRoles('platform_admin'), resetAdminClinicAdminPassword);
router.patch('/clinic-admins/:id/status', authorizeRoles('platform_admin'), updateAdminClinicAdminStatus);
router.get('/appointments', getAdminAppointments);
router.patch('/appointments/:id/status', updateAdminAppointmentStatus);

export default router;
