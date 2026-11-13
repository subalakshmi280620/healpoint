import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import ClinicDoctor from '../models/ClinicDoctor.js';
import DoctorProfile from '../models/DoctorProfile.js';
import User from '../models/User.js';
import { createSlotKeys, getIstDateParts, istDateTimeToUtc, parseCalendarDate, scheduleContainsStart } from '../utils/clinicSchedule.js';
import { isValidObjectId, parsePagination } from '../utils/mongo.js';
import { publishAppointmentNotifications } from '../services/appointmentNotifications.js';

const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;
const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;

const parseStartAt = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const match = ISO_DATE_TIME_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const [, yearPart, monthPart, dayPart, hourPart, minutePart, secondPart, , , , offsetHourPart, offsetMinutePart] = match;
  const [year, month, day, hour, minute, second] = [
    yearPart,
    monthPart,
    dayPart,
    hourPart,
    minutePart,
    secondPart,
  ].map(Number);
  const offsetHour = Number(offsetHourPart || 0);
  const offsetMinute = Number(offsetMinutePart || 0);

  if (
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }

  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
};

const isValidSlot = (date) =>
  date.getTime() > Date.now() &&
  date.getUTCMinutes() % 15 === 0 &&
  date.getUTCSeconds() === 0 &&
  date.getUTCMilliseconds() === 0;

const isDuplicateBooking = (error) => error?.code === 11000;

export const getAvailableDoctors = async (req, res) => {
  const startAt = parseStartAt(req.query.startAt);
  if (!startAt || !isValidSlot(startAt)) {
    return res.status(400).json({
      status: 'error',
      message: 'startAt must be a future ISO date-time on a 15-minute boundary',
    });
  }

  try {
    const users = await User.find({ role: 'doctor', isActive: true }).select('_id');
    const doctors = await DoctorProfile.find({
      user: { $in: users.map((user) => user._id) },
      isActive: true,
    })
      .populate('user', 'name')
      .populate('specialty', 'name');
    const doctorIds = doctors.map((doctor) => doctor._id);
    const associations = await ClinicDoctor.find({
      doctor: { $in: doctorIds },
      isActive: true,
      weeklySchedule: { $ne: [] },
    })
      .populate('clinic', 'name address city state isActive')
      .populate('branch', 'name address city state isActive');
    const doctorById = new Map(doctors.map((doctor) => [String(doctor._id), doctor]));
    const usableAssociations = associations.filter((association) => {
      const doctor = doctorById.get(String(association.doctor));
      const duration = doctor?.consultationDurationMinutes || DEFAULT_APPOINTMENT_DURATION_MINUTES;
      return (
        association.clinic?.isActive &&
        (!association.branch || association.branch.isActive) &&
        scheduleContainsStart(association, startAt, duration)
      );
    });
    const endAt = new Date(
      startAt.getTime() +
        Math.max(
          ...usableAssociations.map((association) =>
            (doctorById.get(String(association.doctor))?.consultationDurationMinutes ||
              DEFAULT_APPOINTMENT_DURATION_MINUTES) * 60 * 1000
          ),
          DEFAULT_APPOINTMENT_DURATION_MINUTES * 60 * 1000
        )
    );
    const unavailable = await Appointment.find({
      doctor: { $in: usableAssociations.map((association) => association.doctor) },
      status: 'confirmed',
      startAt: { $lt: endAt },
      endAt: { $gt: startAt },
    }).select('doctor startAt endAt');
    return res.status(200).json({
      status: 'success',
      data: {
        doctors: usableAssociations
          .filter((association) => {
            const doctor = doctorById.get(String(association.doctor));
            const duration = (doctor?.consultationDurationMinutes || DEFAULT_APPOINTMENT_DURATION_MINUTES) * 60 * 1000;
            const requestedEnd = new Date(startAt.getTime() + duration);
            return !unavailable.some((appointment) =>
              String(appointment.doctor) === String(association.doctor) &&
              appointment.startAt < requestedEnd &&
              appointment.endAt > startAt
            );
          })
          .map((association) => {
            const doctor = doctorById.get(String(association.doctor));
            return {
              id: doctor._id,
              name: doctor.user.name,
              specialty: doctor.specialty.name,
              qualification: doctor.qualification,
              consultationFeeInr: doctor.consultationFee,
              consultationDurationMinutes:
                doctor.consultationDurationMinutes || DEFAULT_APPOINTMENT_DURATION_MINUTES,
              clinicDoctorId: association._id,
              clinic: association.clinic,
              branch: association.branch,
            };
          }),
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to find available doctors',
    });
  }
};

export const getDoctorSlots = async (req, res) => {
  const { doctorId } = req.params;
  const date = parseCalendarDate(req.query.date);
  if (!isValidObjectId(doctorId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid doctor id' });
  }
  if (!date) {
    return res.status(400).json({ status: 'error', message: 'date must be a valid YYYY-MM-DD calendar date' });
  }
  if (req.query.clinicDoctorId !== undefined && !isValidObjectId(req.query.clinicDoctorId)) {
    return res.status(400).json({ status: 'error', message: 'Invalid clinicDoctorId' });
  }

  try {
    const doctor = await DoctorProfile.findOne({
      _id: doctorId,
      isActive: true,
    })
      .populate('user', 'name isActive')
      .populate('specialty', 'name');
    if (!doctor?.user?.isActive || !doctor.specialty) {
      return res.status(404).json({ status: 'error', message: 'Active doctor not found' });
    }

    const associationFilter = {
      doctor: doctor._id,
      isActive: true,
      weeklySchedule: { $ne: [] },
      ...(req.query.clinicDoctorId ? { _id: req.query.clinicDoctorId } : {}),
    };
    const associations = await ClinicDoctor.find(associationFilter)
      .populate({ path: 'clinic', match: { isActive: true }, select: 'name address city state' })
      .populate({ path: 'branch', match: { isActive: true }, select: 'name address city state isActive' });
    const activeAssociations = associations.filter((association) =>
      association.clinic && (!association.branch || association.branch.isActive)
    );
    const durationMinutes =
      doctor.consultationDurationMinutes || DEFAULT_APPOINTMENT_DURATION_MINUTES;
    const { dayOfWeek } = getIstDateParts(date);
    const candidates = [];
    for (const association of activeAssociations) {
      for (const window of association.weeklySchedule) {
        if (window.dayOfWeek !== dayOfWeek) continue;
        const [startHour, startMinute] = window.startTime.split(':').map(Number);
        const [endHour, endMinute] = window.endTime.split(':').map(Number);
        const windowStart = startHour * 60 + startMinute;
        const windowEnd = endHour * 60 + endMinute;
        for (
          let minuteOfDay = windowStart;
          minuteOfDay + durationMinutes <= windowEnd;
          minuteOfDay += durationMinutes
        ) {
          const startAt = istDateTimeToUtc(req.query.date, minuteOfDay);
          if (!startAt || startAt <= new Date()) continue;
          const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
          candidates.push({ association, startAt, endAt, minuteOfDay });
        }
      }
    }

    const earliest = candidates.reduce(
      (value, slot) => (!value || slot.startAt < value ? slot.startAt : value),
      null
    );
    const latest = candidates.reduce(
      (value, slot) => (!value || slot.endAt > value ? slot.endAt : value),
      null
    );
    const booked = earliest && latest
      ? await Appointment.find({
          doctor: doctor._id,
          status: 'confirmed',
          startAt: { $lt: latest },
          endAt: { $gt: earliest },
        }).select('startAt endAt')
      : [];
    const results = activeAssociations.map((association) => ({
      clinicDoctorId: association._id,
      clinic: association.clinic,
      branch: association.branch,
      weeklySchedule: association.weeklySchedule,
      timezone: association.timezone || 'Asia/Kolkata',
      slots: candidates
        .filter((slot) => String(slot.association._id) === String(association._id))
        .filter((slot) => !booked.some((appointment) =>
          appointment.startAt < slot.endAt && appointment.endAt > slot.startAt
        ))
        .map((slot) => ({
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString(),
          localTime: `${String(Math.floor(slot.minuteOfDay / 60)).padStart(2, '0')}:${String(slot.minuteOfDay % 60).padStart(2, '0')}`,
          consultationFeeInr: doctor.consultationFee,
          durationMinutes,
        })),
    }));

    return res.status(200).json({
      status: 'success',
      data: {
        doctor: {
          id: doctor._id,
          name: doctor.user.name,
          specialty: doctor.specialty.name,
          qualification: doctor.qualification,
          consultationFeeInr: doctor.consultationFee,
          consultationDurationMinutes: durationMinutes,
        },
        date: req.query.date,
        timezone: 'Asia/Kolkata',
        associations: results,
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to load appointment slots',
    });
  }
};

export const createAppointment = async (req, res) => {
  const { doctorId, clinicDoctorId, startAt: startAtValue, reason } = req.body;
  const startAt = parseStartAt(startAtValue);

  if (typeof doctorId !== 'string' || !isValidObjectId(doctorId)) {
    return res.status(400).json({ status: 'error', message: 'A valid doctorId is required' });
  }
  if (typeof clinicDoctorId !== 'string' || !isValidObjectId(clinicDoctorId)) {
    return res.status(400).json({ status: 'error', message: 'A valid clinicDoctorId is required' });
  }
  if (!startAt || !isValidSlot(startAt)) {
    return res.status(400).json({
      status: 'error',
      message: 'startAt must be a future ISO date-time on a 15-minute boundary',
    });
  }
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > 1000)) {
    return res.status(400).json({
      status: 'error',
      message: 'reason must be a string of at most 1000 characters',
    });
  }

  try {
    const doctor = await DoctorProfile.findOne({ _id: doctorId, isActive: true });
    if (!doctor) {
      return res.status(404).json({ status: 'error', message: 'Active doctor not found' });
    }

    const doctorUser = await User.findOne({
      _id: doctor.user,
      role: 'doctor',
      isActive: true,
    }).select('_id');
    if (!doctorUser) {
      return res.status(404).json({ status: 'error', message: 'Active doctor not found' });
    }

    const association = await ClinicDoctor.findOne({
      _id: clinicDoctorId,
      doctor: doctor._id,
      isActive: true,
    });
    if (!association) {
      return res.status(404).json({ status: 'error', message: 'Active clinic association not found' });
    }
    const hasBranch = Boolean(association.branch);
    await association.populate([
      { path: 'clinic', match: { isActive: true } },
      { path: 'branch', match: { isActive: true } },
    ]);
    if (!association.clinic || (hasBranch && !association.branch)) {
      return res.status(404).json({ status: 'error', message: 'Active clinic association not found' });
    }
    const durationMinutes =
      doctor.consultationDurationMinutes || DEFAULT_APPOINTMENT_DURATION_MINUTES;
    if (!scheduleContainsStart(association, startAt, durationMinutes)) {
      return res.status(400).json({
        status: 'error',
        message: 'Requested time is outside the doctor’s configured schedule',
      });
    }
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
    const session = await mongoose.startSession();
    let appointment;
    try {
      await session.withTransaction(async () => {
        const conflict = await Appointment.exists({
          doctor: doctor._id,
          status: 'confirmed',
          startAt: { $lt: endAt },
          endAt: { $gt: startAt },
        }).session(session);
        if (conflict) {
          const error = new Error('Doctor is not available at this time');
          error.statusCode = 409;
          throw error;
        }

        [appointment] = await Appointment.create([{
          patient: req.user._id,
          doctor: doctor._id,
          clinicDoctor: association._id,
          clinic: association.clinic._id,
          branch: association.branch?._id || null,
          consultationFeeInr: doctor.consultationFee,
          durationMinutes,
          startAt,
          endAt,
          slotKeys: createSlotKeys(startAt, durationMinutes),
          statusHistory: [{ from: null, to: 'confirmed', changedBy: req.user._id }],
          reason: reason?.trim() || '',
        }], { session });
        await publishAppointmentNotifications({
          appointment,
          actorId: req.user._id,
          event: 'booking',
          session,
        });
      });
    } finally {
      await session.endSession();
    }

    return res.status(201).json({
      status: 'success',
      message: 'Appointment booked successfully',
      data: { appointment },
    });
  } catch (error) {
    if (isDuplicateBooking(error)) {
      return res.status(409).json({ status: 'error', message: 'Doctor is not available at this time' });
    }
    if (error.statusCode === 409) {
      return res.status(409).json({ status: 'error', message: error.message });
    }
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to book appointment',
    });
  }
};

export const getAppointments = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    let filter;

    if (req.user.role === 'patient') {
      filter = { patient: req.user._id };
    } else {
      const doctor = await DoctorProfile.findOne({ user: req.user._id, isActive: true }).select('_id');
      if (!doctor) {
        return res.status(403).json({ status: 'error', message: 'Active doctor profile required' });
      }
      filter = { doctor: doctor._id };
    }

    const now = new Date();
    const [appointments, total, statusGroups, upcoming] = await Promise.all([
      Appointment.find(filter)
        .populate('patient', 'name phone')
        .populate({
          path: 'doctor',
          select: 'user specialty qualification',
          populate: [
            { path: 'user', select: 'name' },
            { path: 'specialty', select: 'name' },
          ],
        })
        .populate('clinic', 'name address city state')
        .populate('branch', 'name address city state')
        .sort({ startAt: -1 })
        .skip(skip)
        .limit(limit),
      Appointment.countDocuments(filter),
      Appointment.aggregate([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Appointment.countDocuments({
        ...filter,
        status: 'confirmed',
        startAt: { $gte: now },
      }),
    ]);
    const byStatus = { confirmed: 0, cancelled: 0, completed: 0 };
    for (const group of statusGroups) byStatus[group._id] = group.count;

    return res.status(200).json({
      status: 'success',
      results: appointments.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      data: {
        appointments,
        stats: { total, upcoming, byStatus },
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to fetch appointments',
    });
  }
};

export const updateAppointmentStatus = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!isValidObjectId(id)) {
    return res.status(400).json({ status: 'error', message: 'Invalid appointment id' });
  }
  if (!['cancelled', 'completed'].includes(status)) {
    return res.status(400).json({
      status: 'error',
      message: 'status must be cancelled or completed',
    });
  }

  try {
    let ownershipFilter;
    if (req.user.role === 'patient') {
      if (status === 'completed') {
        return res.status(403).json({
          status: 'error',
          message: 'Only the assigned doctor can complete an appointment',
        });
      }
      ownershipFilter = { patient: req.user._id };
    }

    if (req.user.role === 'doctor') {
      const doctor = await DoctorProfile.findOne({ user: req.user._id, isActive: true }).select('_id');
      if (!doctor) {
        return res.status(403).json({
          status: 'error',
          message: 'Not authorized to update this appointment',
        });
      }
      ownershipFilter = { doctor: doctor._id };
    }

    if (!ownershipFilter) {
      return res.status(403).json({ status: 'error', message: 'Not authorized to update this appointment' });
    }

    const session = await mongoose.startSession();
    let appointment;
    try {
      await session.withTransaction(async () => {
        const now = new Date();
        const statusFilter = {
          _id: id,
          status: 'confirmed',
          ...ownershipFilter,
          ...(status === 'completed'
            ? { startAt: { $lte: now } }
            : status === 'cancelled'
              ? { startAt: { $gt: now } }
              : {}),
        };
        appointment = await Appointment.findOneAndUpdate(
          statusFilter,
          {
            $set: { status },
            $push: {
              statusHistory: {
                from: 'confirmed',
                to: status,
                changedBy: req.user._id,
              },
            },
          },
          { returnDocument: 'after', runValidators: true, session }
        );
        if (appointment) {
          await publishAppointmentNotifications({
            appointment,
            actorId: req.user._id,
            event: status === 'cancelled' ? 'cancellation' : 'completion',
            session,
          });
        }
      });
    } finally {
      await session.endSession();
    }
    if (appointment) {
      return res.status(200).json({
        status: 'success',
        message: 'Appointment status updated successfully',
        data: { appointment },
      });
    }

    const existing = await Appointment.findById(id).select('patient doctor status startAt');
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Appointment not found' });
    }
    const ownsAppointment =
      req.user.role === 'patient'
        ? String(existing.patient) === String(req.user._id)
        : String(existing.doctor) === String(ownershipFilter.doctor);
    if (!ownsAppointment) {
      return res.status(403).json({
        status: 'error',
        message: 'Not authorized to update this appointment',
      });
    }
    if (existing.status !== 'confirmed') {
      return res.status(409).json({ status: 'error', message: 'Only confirmed appointments can be updated' });
    }
    if (status === 'completed' && existing.startAt > new Date()) {
      return res.status(409).json({
        status: 'error',
        message: 'Appointments can only be completed after their scheduled start time',
      });
    }
    if (status === 'cancelled' && existing.startAt <= new Date()) {
      return res.status(409).json({
        status: 'error',
        message: 'Appointments cannot be cancelled after their scheduled start time',
      });
    }
    return res.status(409).json({ status: 'error', message: 'Appointment status changed; try again' });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to update appointment',
    });
  }
};
