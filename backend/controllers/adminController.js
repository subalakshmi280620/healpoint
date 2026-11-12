import mongoose from 'mongoose';
import Appointment from '../models/Appointment.js';
import Clinic from '../models/Clinic.js';
import ClinicDoctor from '../models/ClinicDoctor.js';
import ClinicBranch from '../models/ClinicBranch.js';
import DoctorProfile from '../models/DoctorProfile.js';
import Specialty from '../models/Specialty.js';
import User from '../models/User.js';
import { publishAppointmentNotifications } from '../services/appointmentNotifications.js';
import { getClinicAdminClinicFilter, isClinicAdminForClinic } from '../utils/clinicAccess.js';
import { escapeRegex, isValidObjectId, parsePagination } from '../utils/mongo.js';
import { validateRegisterInput } from '../utils/validateAuth.js';

const USER_ROLES = ['patient', 'doctor'];
const APPOINTMENT_STATUSES = ['confirmed', 'cancelled', 'completed'];
const DEFAULT_SPECIALTIES = [
  'General Physician',
  'Cardiologist',
  'Dermatologist',
  'Pediatrician',
  'Gynecologist',
  'Orthopedic',
  'Dentist',
];
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

const parseDateFilter = (value) => {
  if (typeof value !== 'string' || !ISO_DATE_TIME_PATTERN.test(value)) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getAdminScope = async (user) => {
  if (user.role === 'platform_admin') {
    return { platformWide: true, clinicIds: null, doctorIds: null, clinicDoctorIds: null };
  }

  const clinics = await Clinic.find(getClinicAdminClinicFilter(user)).select('_id');
  const clinicIds = clinics.map((clinic) => clinic._id);
  if (clinicIds.length === 0) {
    return { platformWide: false, clinicIds, clinicDoctorIds: [], doctorIds: [] };
  }

  const associations = await ClinicDoctor.find({
    clinic: { $in: clinicIds },
  }).select('_id doctor');
  const clinicDoctorIds = associations.map((association) => association._id);
  const doctorIds = [
    ...new Map(associations.map((association) => [String(association.doctor), association.doctor])).values(),
  ];
  return {
    platformWide: false,
    clinicIds,
    clinicDoctorIds,
    doctorIds,
  };
};

const getAppointmentScope = (scope) =>
  scope.platformWide
    ? {}
    : {
        $or: [
          { clinic: { $in: scope.clinicIds } },
          {
            clinic: null,
            clinicDoctor: { $in: scope.clinicDoctorIds },
          },
        ],
      };

const createSearchFilter = (search) => {
  if (typeof search !== 'string' || !search.trim()) {
    return {};
  }
  const expression = new RegExp(escapeRegex(search.trim()), 'i');
  return { $or: [{ name: expression }, { email: expression }] };
};

const buildAppointmentFilter = (query, scope) => {
  const filter = getAppointmentScope(scope);

  if (query.status !== undefined) {
    if (!APPOINTMENT_STATUSES.includes(query.status)) {
      return { error: 'status must be confirmed, cancelled, or completed' };
    }
    filter.status = query.status;
  }

  for (const field of ['doctorId', 'patientId']) {
    if (query[field] !== undefined) {
      if (typeof query[field] !== 'string' || !isValidObjectId(query[field])) {
        return { error: `${field} must be a valid MongoDB id` };
      }
      if (field === 'doctorId' && !scope.platformWide) {
        const isInScope = scope.doctorIds.some((doctorId) => String(doctorId) === query.doctorId);
        filter.doctor = isInScope ? query.doctorId : { $in: [] };
      } else {
        filter[field === 'doctorId' ? 'doctor' : 'patient'] = query[field];
      }
    }
  }

  const from = query.from === undefined ? null : parseDateFilter(query.from);
  const to = query.to === undefined ? null : parseDateFilter(query.to);
  if ((query.from !== undefined && !from) || (query.to !== undefined && !to)) {
    return { error: 'from and to must be valid ISO date-times with a timezone' };
  }
  if (from && to && from > to) {
    return { error: 'from must be earlier than or equal to to' };
  }
  if (from || to) {
    filter.startAt = {};
    if (from) filter.startAt.$gte = from;
    if (to) filter.startAt.$lte = to;
  }

  return { filter };
};

const formatClinic = (clinic, branches = []) => ({
  id: clinic._id,
  name: clinic.name,
  description: clinic.description,
  email: clinic.email,
  phone: clinic.phone,
  address: clinic.address,
  city: clinic.city,
  state: clinic.state,
  pincode: clinic.pincode,
  location: clinic.location || null,
  logo: clinic.logo,
  isActive: clinic.isActive,
  createdBy: clinic.createdBy,
  createdAt: clinic.createdAt,
  updatedAt: clinic.updatedAt,
  branches: branches.map((branch) => ({
    id: branch._id,
    name: branch.name,
    address: branch.address,
    city: branch.city,
    state: branch.state,
    pincode: branch.pincode,
    phone: branch.phone,
    isActive: branch.isActive,
    location: branch.location || null,
  })),
});

export const getAdminClinics = async (req, res) => {
  try {
    const scope = await getAdminScope(req.user);
    const { page, limit, skip } = parsePagination(req.query);
    const filter = scope.platformWide ? {} : { _id: { $in: scope.clinicIds } };
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      const expression = new RegExp(escapeRegex(req.query.search.trim()), 'i');
      filter.$or = [
        { name: expression },
        { email: expression },
        { city: expression },
        { state: expression },
      ];
    }
    const [clinics, total] = await Promise.all([
      Clinic.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Clinic.countDocuments(filter),
    ]);
    const branches = await ClinicBranch.find({
      clinic: { $in: clinics.map((clinic) => clinic._id) },
    });
    const branchesByClinic = new Map();
    for (const branch of branches) {
      const key = String(branch.clinic);
      branchesByClinic.set(key, [...(branchesByClinic.get(key) || []), branch]);
    }

    return res.status(200).json({
      status: 'success',
      results: clinics.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      data: {
        clinics: clinics.map((clinic) =>
          formatClinic(clinic, branchesByClinic.get(String(clinic._id)) || [])
        ),
      },
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message || 'Unable to list clinics' });
  }
};

export const getAdminDoctors = async (req, res) => {
  try {
    const scope = await getAdminScope(req.user);
    const { page, limit, skip } = parsePagination(req.query);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const filter = scope.platformWide ? {} : { _id: { $in: scope.doctorIds } };
    if (search) {
      const expression = new RegExp(escapeRegex(search), 'i');
      const [users, specialties] = await Promise.all([
        User.find({ role: 'doctor', $or: [{ name: expression }, { email: expression }] }).select('_id'),
        Specialty.find({ name: expression }).select('_id'),
      ]);
      const [nameMatches, specialtyMatches] = await Promise.all([
        DoctorProfile.find({ user: { $in: users.map((user) => user._id) } }).select('_id'),
        DoctorProfile.find({ specialty: { $in: specialties.map((specialty) => specialty._id) } }).select('_id'),
      ]);
      const matchingIds = [...new Set([...nameMatches, ...specialtyMatches].map((doctor) => String(doctor._id)))];
      filter._id = filter._id
        ? { $in: filter._id.$in.filter((id) => matchingIds.includes(String(id))) }
        : { $in: matchingIds };
    }
    if (req.query.specialty !== undefined) {
      const specialtyFilter = isValidObjectId(req.query.specialty)
        ? { _id: req.query.specialty }
        : { name: new RegExp(escapeRegex(String(req.query.specialty)), 'i') };
      const specialties = await Specialty.find(specialtyFilter).select('_id');
      filter.specialty = { $in: specialties.map((specialty) => specialty._id) };
    }
    if (req.query.status !== undefined) {
      if (!['active', 'inactive'].includes(req.query.status)) {
        return res.status(400).json({ status: 'error', message: 'status must be active or inactive' });
      }
      const activeUsers = await User.find({
        role: 'doctor',
        isActive: req.query.status === 'active',
      }).select('_id');
      if (req.query.status === 'active') {
        filter.isActive = true;
        filter.user = { $in: activeUsers.map((user) => user._id) };
      } else {
        filter.$or = [
          { isActive: false },
          { user: { $in: activeUsers.map((user) => user._id) } },
        ];
      }
    }

    const sortFields = {
      createdAt: 'createdAt',
      fee: 'consultationFee',
      experience: 'experienceYears',
    };
    const sortField = sortFields[req.query.sortBy] || 'createdAt';
    const sortOrder = req.query.order === 'asc' ? 1 : -1;
    const [doctors, total] = await Promise.all([
      DoctorProfile.find(filter)
        .populate('user', 'name email phone role isActive')
        .populate('specialty', 'name description isActive')
        .sort({ [sortField]: sortOrder, _id: 1 })
        .skip(skip)
        .limit(limit),
      DoctorProfile.countDocuments(filter),
    ]);
    const associations = await ClinicDoctor.find({
      doctor: { $in: doctors.map((doctor) => doctor._id) },
      ...(scope.platformWide ? {} : { clinic: { $in: scope.clinicIds } }),
    })
      .populate('clinic', 'name address city state isActive')
      .populate('branch', 'name address city state isActive');
    const associationsByDoctor = new Map();
    for (const association of associations) {
      const key = String(association.doctor);
      associationsByDoctor.set(key, [
        ...(associationsByDoctor.get(key) || []),
        association,
      ]);
    }
    const formattedDoctors = doctors.map((doctor) => ({
      ...doctor.toObject({ virtuals: true }),
      consultationFeeInr: doctor.consultationFee,
      clinicAssociations: (associationsByDoctor.get(String(doctor._id)) || []).map((association) => ({
        id: association._id,
        clinic: association.clinic,
        branch: association.branch,
        weeklySchedule: association.weeklySchedule,
        timezone: association.timezone || 'Asia/Kolkata',
        isActive: association.isActive,
      })),
    }));

    return res.status(200).json({
      status: 'success',
      results: doctors.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      data: { doctors: formattedDoctors },
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message || 'Unable to list doctors' });
  }
};

export const getAdminDoctorCandidates = async (req, res) => {
  try {
    const scope = await getAdminScope(req.user);
    const { page, limit, skip } = parsePagination(req.query);
    if (!scope.platformWide && scope.clinicIds.length === 0) {
      return res.status(200).json({
        status: 'success',
        results: 0,
        pagination: { page, limit, total: 0, pages: 1 },
        data: { users: [] },
      });
    }
    const filter = { isActive: true };
    if (!scope.platformWide) {
      const clinicAssociations = await ClinicDoctor.find({
        clinic: { $in: scope.clinicIds },
        isActive: true,
      }).select('doctor');
      const outsideAssociations = await ClinicDoctor.find({
        clinic: { $nin: scope.clinicIds },
      }).select('doctor');
      const [assignedUsers, outsideUsers] = await Promise.all([
        DoctorProfile.distinct('user', {
          _id: { $in: clinicAssociations.map((association) => association.doctor) },
        }),
        DoctorProfile.distinct('user', {
          _id: { $in: outsideAssociations.map((association) => association.doctor) },
        }),
      ]);
      const clinicPatientIds = await Appointment.distinct(
        'patient',
        getAppointmentScope(scope)
      );
      filter.$or = [
        {
          role: 'doctor',
          _id: { $nin: [...assignedUsers, ...outsideUsers] },
        },
        {
          role: 'patient',
          _id: { $in: clinicPatientIds },
        },
      ];
    } else {
      filter.role = { $in: ['doctor', 'patient'] };
    }
    if (typeof req.query.search === 'string' && req.query.search.trim()) {
      const expression = new RegExp(escapeRegex(req.query.search.trim()), 'i');
      filter.$and = [{ $or: [{ name: expression }, { email: expression }] }];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .select('name email role')
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);
    const profiles = await DoctorProfile.find({
      user: { $in: users.map((user) => user._id) },
    }).populate('specialty', 'name');
    const profileByUser = new Map(
      profiles.map((profile) => [String(profile.user), profile])
    );
    return res.status(200).json({
      status: 'success',
      results: users.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      data: {
        users: users.map((user) => ({
          ...user.toObject(),
          doctorProfile: profileByUser.get(String(user._id)) || null,
        })),
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to load doctor candidates',
    });
  }
};

export const getAdminClinicAdmins = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {
      role: 'clinic_admin',
      ...createSearchFilter(req.query.search),
    };
    const [users, total] = await Promise.all([
      User.find(filter)
        .select('name email phone role isActive clinic createdAt')
        .populate('clinic', 'name city isActive')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      status: 'success',
      results: users.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      data: {
        clinicAdmins: users.map((user) => ({
          ...user.toSafeObject(),
          _id: user._id,
          clinic: user.clinic
            ? {
                id: user.clinic._id,
                name: user.clinic.name,
                city: user.clinic.city,
                isActive: user.clinic.isActive,
              }
            : null,
        })),
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to list clinic admin accounts',
    });
  }
};

export const createAdminClinicAdmin = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (['name', 'email', 'phone', 'password'].some((field) => typeof body[field] !== 'string')) {
    return res.status(400).json({
      status: 'error',
      message: 'Name, email, phone, and password are required',
    });
  }
  const validationErrors = validateRegisterInput(body);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      status: 'error',
      message: validationErrors[0],
      errors: validationErrors,
    });
  }
  const name = body.name.trim();
  const phone = body.phone.trim();
  if (name.length > 100) {
    return res.status(400).json({ status: 'error', message: 'Name must be at most 100 characters' });
  }
  if (!phone || phone.length > 30) {
    return res.status(400).json({ status: 'error', message: 'Phone is required and must be at most 30 characters' });
  }
  if (!isValidObjectId(body.clinicId)) {
    return res.status(400).json({ status: 'error', message: 'A valid clinicId is required' });
  }

  try {
    const clinic = await Clinic.findById(body.clinicId).select('name city isActive');
    if (!clinic || !clinic.isActive) {
      return res.status(404).json({ status: 'error', message: 'Active clinic not found' });
    }

    const user = await User.create({
      name,
      email: body.email.trim().toLowerCase(),
      phone,
      password: body.password,
      clinic: clinic._id,
      role: 'clinic_admin',
      isActive: true,
    });
    return res.status(201).json({
      status: 'success',
      message: 'Clinic Admin account created successfully',
      data: {
        user: user.toSafeObject(),
        clinic: { id: clinic._id, name: clinic.name, city: clinic.city, isActive: clinic.isActive },
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ status: 'error', message: 'Email is already registered' });
    }
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to create Clinic Admin account',
    });
  }
};

export const updateAdminClinicAdminStatus = async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ status: 'error', message: 'Invalid user id' });
  }
  if (typeof req.body?.isActive !== 'boolean') {
    return res.status(400).json({ status: 'error', message: 'isActive must be a boolean' });
  }

  try {
    const user = await User.findOne({ _id: req.params.id, role: 'clinic_admin' });
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'Clinic Admin account not found' });
    }
    if (user.isActive && !req.body.isActive) {
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }
    user.isActive = req.body.isActive;
    await user.save();
    return res.status(200).json({
      status: 'success',
      message: `Clinic Admin account ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      data: { user: user.toSafeObject() },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to update Clinic Admin account status',
    });
  }
};

export const createAdminDoctorAccount = async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const validationErrors = validateRegisterInput(body);
  if (validationErrors.length > 0) {
    return res.status(400).json({
      status: 'error',
      message: validationErrors[0],
      errors: validationErrors,
    });
  }
  if (String(body.name).trim().length > 100) {
    return res.status(400).json({ status: 'error', message: 'Name must be at most 100 characters' });
  }
  if (body.phone !== undefined && (
    typeof body.phone !== 'string' || body.phone.trim().length > 30
  )) {
    return res.status(400).json({ status: 'error', message: 'Phone must be a string of at most 30 characters' });
  }
  if (!isValidObjectId(body.clinicId)) {
    return res.status(400).json({ status: 'error', message: 'A valid clinicId is required' });
  }

  try {
    const clinic = await Clinic.findById(body.clinicId).select('createdBy isActive');
    if (!clinic || !clinic.isActive) {
      return res.status(404).json({ status: 'error', message: 'Active clinic not found' });
    }
    if (req.user.role === 'clinic_admin' && !isClinicAdminForClinic(req.user, clinic)) {
      return res.status(403).json({
        status: 'error',
        message: 'Not authorized to create doctor accounts for this clinic',
      });
    }

    const user = await User.create({
      name: String(body.name).trim(),
      email: String(body.email).trim().toLowerCase(),
      password: body.password,
      phone: body.phone ? body.phone.trim() : '',
      role: 'doctor',
      isActive: true,
    });
    return res.status(201).json({
      status: 'success',
      message: 'Doctor account created successfully',
      data: { user: user.toSafeObject() },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ status: 'error', message: 'Email is already registered' });
    }
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to create doctor account',
    });
  }
};

const ensureDefaultSpecialties = async () => {
  await Promise.all(DEFAULT_SPECIALTIES.map(async (name) => {
    const existing = await Specialty.findOne({
      name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
    }).select('_id');
    if (existing) return;

    try {
      await Specialty.create({ name });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }));
};

export const getAdminSpecialties = async (req, res) => {
  try {
    await ensureDefaultSpecialties();
    const specialties = await Specialty.find({})
      .select('name description isActive')
      .sort({ name: 1 });
    return res.status(200).json({ status: 'success', data: { specialties } });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to load specialties',
    });
  }
};

export const createAdminSpecialty = async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 2 || name.length > 100) {
    return res.status(400).json({ status: 'error', message: 'Specialty name must be 2–100 characters' });
  }
  if (req.body.description !== undefined && (
    typeof req.body.description !== 'string' || req.body.description.length > 500
  )) {
    return res.status(400).json({ status: 'error', message: 'description must be at most 500 characters' });
  }

  try {
    const existing = await Specialty.findOne({
      name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
    }).select('_id');
    if (existing) {
      return res.status(409).json({ status: 'error', message: 'Specialty already exists' });
    }
    const specialty = await Specialty.create({
      name,
      description: req.body.description?.trim() || '',
    });
    return res.status(201).json({
      status: 'success',
      message: 'Specialty created successfully',
      data: { specialty },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ status: 'error', message: 'Specialty already exists' });
    }
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to create specialty',
    });
  }
};

export const getAdminUsers = async (req, res) => {
  const role = req.query.role === undefined ? 'patient' : req.query.role;
  if (!USER_ROLES.includes(role)) {
    return res.status(400).json({ status: 'error', message: 'role must be patient or doctor' });
  }

  try {
    const scope = await getAdminScope(req.user);
    const { page, limit, skip } = parsePagination(req.query);
    let userIds = null;

    if (!scope.platformWide) {
      if (role === 'doctor') {
        const doctors = await DoctorProfile.find({ _id: { $in: scope.doctorIds } }).select('user');
        userIds = doctors.map((doctor) => doctor.user);
      } else {
        const patientIds = await Appointment.distinct('patient', getAppointmentScope(scope));
        userIds = patientIds;
      }
    }

    const filter = {
      role,
      ...(userIds === null ? {} : { _id: { $in: userIds } }),
      ...createSearchFilter(req.query.search),
    };
    const [users, total] = await Promise.all([
      User.find(filter)
        .select('name email phone role isActive createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      status: 'success',
      results: users.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      data: { users },
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message || 'Unable to list users' });
  }
};

export const updateAdminUserStatus = async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    return res.status(400).json({ status: 'error', message: 'Invalid user id' });
  }
  if (typeof req.body?.isActive !== 'boolean') {
    return res.status(400).json({ status: 'error', message: 'isActive must be a boolean' });
  }

  try {
    const user = await User.findOne({
      _id: req.params.id,
      role: { $in: USER_ROLES },
    });
    if (!user) {
      return res.status(404).json({ status: 'error', message: 'Patient or doctor account not found' });
    }

    if (user.isActive && !req.body.isActive) {
      user.tokenVersion = (user.tokenVersion || 0) + 1;
    }
    user.isActive = req.body.isActive;
    await user.save();
    return res.status(200).json({
      status: 'success',
      message: `Account ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      data: { user: user.toSafeObject() },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to update user status',
    });
  }
};

export const getAdminAppointments = async (req, res) => {
  try {
    const scope = await getAdminScope(req.user);
    const { filter, error } = buildAppointmentFilter(req.query, scope);
    if (error) {
      return res.status(400).json({ status: 'error', message: error });
    }
    const { page, limit, skip } = parsePagination(req.query);
    const [appointments, total] = await Promise.all([
      Appointment.find(filter)
        .populate('patient', 'name email phone')
        .populate({
          path: 'doctor',
          select: 'user specialty qualification',
          populate: [
            { path: 'user', select: 'name email' },
            { path: 'specialty', select: 'name' },
          ],
        })
        .populate('clinic', 'name address city state')
        .populate('branch', 'name address city state')
        .sort({ startAt: -1 })
        .skip(skip)
        .limit(limit),
      Appointment.countDocuments(filter),
    ]);

    return res.status(200).json({
      status: 'success',
      results: appointments.length,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      data: { appointments },
    });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message || 'Unable to list appointments' });
  }
};

export const updateAdminAppointmentStatus = async (req, res) => {
  const { id } = req.params;
  if (typeof id !== 'string' || !isValidObjectId(id)) {
    return res.status(400).json({ status: 'error', message: 'Invalid appointment id' });
  }
  if (req.body.status !== 'cancelled') {
    return res.status(400).json({
      status: 'error',
      message: 'Admins may only cancel confirmed appointments',
    });
  }

  try {
    const scope = await getAdminScope(req.user);
    const scopeFilter = getAppointmentScope(scope);
    const session = await mongoose.startSession();
    let appointment;
    try {
      await session.withTransaction(async () => {
        appointment = await Appointment.findOneAndUpdate(
          { _id: id, status: 'confirmed', ...scopeFilter },
          {
            $set: { status: 'cancelled' },
            $push: {
              statusHistory: {
                from: 'confirmed',
                to: 'cancelled',
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
            event: 'cancellation',
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
        message: 'Appointment cancelled successfully',
        data: { appointment },
      });
    }

    const existing = await Appointment.exists({ _id: id });
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Appointment not found' });
    }
    const inScope = await Appointment.exists({ _id: id, ...scopeFilter });
    if (!inScope) {
      return res.status(404).json({ status: 'error', message: 'Appointment not found' });
    }
    return res.status(409).json({
      status: 'error',
      message: 'Only confirmed appointments can be cancelled',
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to cancel appointment',
    });
  }
};

export const getAdminDashboardStats = async (req, res) => {
  try {
    const scope = await getAdminScope(req.user);
    const clinicFilter = scope.platformWide ? {} : { _id: { $in: scope.clinicIds } };
    const doctorFilter = scope.platformWide ? {} : { _id: { $in: scope.doctorIds } };
    const patientIds = scope.platformWide
      ? null
      : await Appointment.distinct('patient', getAppointmentScope(scope));
    const patientFilter = {
      role: 'patient',
      ...(patientIds === null ? {} : { _id: { $in: patientIds } }),
    };
    const appointmentFilter = getAppointmentScope(scope);

    const [
      clinicCount,
      activeClinicCount,
      doctorCount,
      activeDoctorProfiles,
      patientCount,
      appointmentGroups,
    ] = await Promise.all([
      Clinic.countDocuments(clinicFilter),
      Clinic.countDocuments({ ...clinicFilter, isActive: true }),
      DoctorProfile.countDocuments(doctorFilter),
      DoctorProfile.find({ ...doctorFilter, isActive: true }).select('user'),
      User.countDocuments(patientFilter),
      Appointment.aggregate([
        { $match: appointmentFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);
    const activeDoctorCount = await User.countDocuments({
      _id: { $in: activeDoctorProfiles.map((doctor) => doctor.user) },
      role: 'doctor',
      isActive: true,
    });

    const byStatus = Object.fromEntries(APPOINTMENT_STATUSES.map((status) => [status, 0]));
    for (const group of appointmentGroups) {
      byStatus[group._id] = group.count;
    }

    return res.status(200).json({
      status: 'success',
      data: {
        clinics: { total: clinicCount, active: activeClinicCount },
        doctors: { total: doctorCount, active: activeDoctorCount },
        patients: { total: patientCount },
        appointments: {
          total: Object.values(byStatus).reduce((total, count) => total + count, 0),
          byStatus,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to load dashboard statistics',
    });
  }
};
