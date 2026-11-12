import { Router } from 'express';
import {
  createAppointment,
  getAppointments,
  getAvailableDoctors,
  getDoctorSlots,
  updateAppointmentStatus,
} from '../controllers/appointmentController.js';
import { protect } from '../middleware/authMiddleware.js';
import { authorizeRoles } from '../middleware/roleMiddleware.js';

const router = Router();

router.get('/doctors/:doctorId/slots', getDoctorSlots);
router.use(protect);
router.get('/doctors', authorizeRoles('patient'), getAvailableDoctors);
router.get('/', authorizeRoles('patient', 'doctor'), getAppointments);
router.post('/', authorizeRoles('patient'), createAppointment);
router.patch('/:id/status', authorizeRoles('patient', 'doctor'), updateAppointmentStatus);

export default router;
