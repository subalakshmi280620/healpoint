import Clinic from '../models/Clinic.js';
import ClinicBranch from '../models/ClinicBranch.js';
import ClinicDoctor from '../models/ClinicDoctor.js';
import DoctorProfile from '../models/DoctorProfile.js';
import Specialty from '../models/Specialty.js';
import User from '../models/User.js';
import { escapeRegex, isValidObjectId, parsePagination } from '../utils/mongo.js';
import { getClinicAdminClinicFilter, isClinicAdminForClinic } from '../utils/clinicAccess.js';
import {
  findLocationMatches,
  getAssociationDistanceKm,
  isAssociationInLocationMatches,
} from '../utils/locationSearch.js';
import { validateDoctorInput } from '../utils/validateClinicDoctor.js';

const doctorPopulate = [
  { path: 'user', select: 'name email phone role isActive' },
  { path: 'specialty', select: 'name description isActive' },
];

const formatDoctor = (doctor, clinics = []) => {
  const data = doctor.toObject({ virtuals: true });

  return {
    id: data._id,
    user: data.user
      ? {
          id: data.user._id,
          name: data.user.name,
          email: data.user.email,
          phone: data.user.phone,
          role: data.user.role,
          isActive: data.user.isActive,
        }
      : data.user,
    specialty: data.specialty
      ? {
          id: data.specialty._id,
          name: data.specialty.name,
          description: data.specialty.description,
          isActive: data.specialty.isActive,
        }
      : data.specialty,
    qualification: data.qualification,
    experienceYears: data.experienceYears,
    consultationFee: data.consultationFee,
    consultationFeeInr: data.consultationFee,
    consultationDurationMinutes: data.consultationDurationMinutes || 30,
    languagesSpoken: data.languagesSpoken || [],
    bio: data.bio,
    profileImage: data.profileImage,
    isActive: data.isActive,
    distanceKm: clinics.reduce(
      (minimum, clinic) =>
        clinic.distanceKm === null || clinic.distanceKm === undefined
          ? minimum
          : minimum === null
            ? clinic.distanceKm
            : Math.min(minimum, clinic.distanceKm),
      null
    ),
    clinics,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
};

const getManagedClinicIds = async (user) => {
  if (user.role === 'platform_admin') {
    const clinics = await Clinic.find({}).select('_id');
    return clinics.map((clinic) => String(clinic._id));
  }

  if (user.role === 'clinic_admin') {
    const clinics = await Clinic.find(getClinicAdminClinicFilter(user)).select('_id');
    return clinics.map((clinic) => String(clinic._id));
  }

  return [];
};

const canManageDoctor = async (user, doctor, clinicId = null) => {
  if (user.role === 'platform_admin') {
    return true;
  }

  if (user.role === 'doctor' && String(doctor.user._id || doctor.user) === String(user._id)) {
    return true;
  }

  if (user.role === 'clinic_admin') {
    const managedClinicIds = await getManagedClinicIds(user);
    if (managedClinicIds.length === 0) {
      return false;
    }

    const associationClinicIds = clinicId
      ? managedClinicIds.filter((managedClinicId) => managedClinicId === String(clinicId))
      : managedClinicIds;
    if (associationClinicIds.length === 0) {
      return false;
    }

    return Boolean(await ClinicDoctor.exists({
      doctor: doctor._id,
      clinic: { $in: associationClinicIds },
      isActive: true,
    }));
  }

  return false;
};

const assertClinicAssociationAccess = async ({ clinicId, branchId, actor }) => {
  if (!isValidObjectId(clinicId)) {
    const error = new Error('clinicId must be a valid MongoDB id');
    error.statusCode = 400;
    throw error;
  }
  if (!['platform_admin', 'clinic_admin'].includes(actor.role)) {
    const error = new Error('Only an authorized clinic admin can change clinic settings');
    error.statusCode = 403;
    throw error;
  }
  const clinic = await Clinic.findById(clinicId);
  if (!clinic || !clinic.isActive) {
    const error = new Error('Clinic not found');
    error.statusCode = 404;
    throw error;
  }
  if (actor.role === 'clinic_admin' && !isClinicAdminForClinic(actor, clinic)) {
    const error = new Error('Not authorized to assign doctors to this clinic');
    error.statusCode = 403;
    throw error;
  }
  if (branchId) {
    const branch = await ClinicBranch.exists({
      _id: branchId,
      clinic: clinicId,
      isActive: true,
    });
    if (!branch) {
      const error = new Error('Branch must be an active branch of the selected clinic');
      error.statusCode = 400;
      throw error;
    }
  }
};

const associateDoctorWithClinic = async ({
  clinicId,
  doctorId,
  actor,
  branchId,
  weeklySchedule,
  associationIsActive,
  updateExisting = false,
}) => {
  if (!clinicId) {
    return null;
  }

  if (!isValidObjectId(clinicId)) {
    const error = new Error('clinicId must be a valid MongoDB id');
    error.statusCode = 400;
    throw error;
  }

  const clinic = await Clinic.findById(clinicId);
  if (!clinic || !clinic.isActive) {
    const error = new Error('Clinic not found');
    error.statusCode = 404;
    throw error;
  }

  if (actor.role === 'doctor') {
    const error = new Error('Only clinic admins can associate doctors with clinics');
    error.statusCode = 403;
    throw error;
  }

  if (actor.role === 'clinic_admin' && !isClinicAdminForClinic(actor, clinic)) {
    const error = new Error('Not authorized to assign doctors to this clinic');
    error.statusCode = 403;
    throw error;
  }

  let branch = null;
  if (branchId) {
    branch = await ClinicBranch.findOne({
      _id: branchId,
      clinic: clinicId,
      isActive: true,
    });
    if (!branch) {
      const error = new Error('Branch must be an active branch of the selected clinic');
      error.statusCode = 400;
      throw error;
    }
  }

  const existing = await ClinicDoctor.findOne({ clinic: clinicId, doctor: doctorId });
  if (existing) {
    if (!updateExisting) {
      const duplicateError = new Error('Doctor is already associated with this clinic');
      duplicateError.statusCode = 409;
      throw duplicateError;
    }
    if (branchId !== undefined) existing.branch = branch?._id || null;
    if (weeklySchedule !== undefined) existing.weeklySchedule = weeklySchedule;
    if (associationIsActive !== undefined) existing.isActive = associationIsActive;
    await existing.save();
    return existing;
  }

  try {
    return await ClinicDoctor.create({
      clinic: clinicId,
      doctor: doctorId,
      branch: branch?._id || null,
      weeklySchedule: weeklySchedule || [],
      isActive: associationIsActive ?? true,
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicateError = new Error('Doctor is already associated with this clinic');
      duplicateError.statusCode = 409;
      throw duplicateError;
    }
    throw error;
  }
};

const getClinicsForDoctor = async (doctorId, locationMatches = null) => {
  const associations = await ClinicDoctor.find({ doctor: doctorId, isActive: true })
    .populate('clinic', 'name address city state isActive location')
    .populate('branch', 'name address city state isActive location');

  return associations
    .filter((item) =>
      item.clinic &&
      item.clinic.isActive &&
      (!item.branch || item.branch.isActive) &&
      isAssociationInLocationMatches(item, locationMatches)
    )
    .map((item) => ({
      id: item.clinic._id,
      name: item.clinic.name,
      address: item.clinic.address,
      city: item.clinic.city,
      state: item.clinic.state,
      location: item.branch?.location || item.clinic.location || null,
      distanceKm: getAssociationDistanceKm(item, locationMatches),
      clinicDoctorId: item._id,
      branch: item.branch
        ? {
            id: item.branch._id,
            name: item.branch.name,
            address: item.branch.address,
            city: item.branch.city,
            state: item.branch.state,
            location: item.branch.location || null,
          }
        : null,
      weeklySchedule: item.weeklySchedule,
      timezone: item.timezone || 'Asia/Kolkata',
    }));
};

export const getSpecialties = async (req, res) => {
  try {
    const specialties = await Specialty.find({ isActive: true })
      .select('name description')
      .sort({ name: 1 });
    return res.status(200).json({ status: 'success', data: { specialties } });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to load specialties',
    });
  }
};

export const getDoctors = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const locationMatches = await findLocationMatches(req.query);
    const activeUsers = await User.find({ role: 'doctor', isActive: true }).select('_id');
    const filter = {
      isActive: true,
      user: { $in: activeUsers.map((user) => user._id) },
    };
    const andConditions = [];

    if (locationMatches) {
      const associations = locationMatches.clinicIds.length
        ? await ClinicDoctor.find({
            clinic: { $in: locationMatches.clinicIds },
            isActive: true,
          })
            .populate('clinic', 'isActive')
            .populate('branch', 'isActive location')
        : [];
      const matchingDoctorIds = associations
        .filter((association) =>
          association.clinic?.isActive &&
          (!association.branch || association.branch.isActive) &&
          isAssociationInLocationMatches(association, locationMatches)
        )
        .map((association) => association.doctor);
      andConditions.push({ _id: { $in: matchingDoctorIds } });
    }

    if (req.query.name) {
      const users = await User.find({
        role: 'doctor',
        name: new RegExp(escapeRegex(req.query.name), 'i'),
      }).select('_id');
      andConditions.push({ user: { $in: users.map((user) => user._id) } });
    }

    if (req.query.specialty) {
      const specialties = await Specialty.find({
        name: new RegExp(escapeRegex(req.query.specialty), 'i'),
        isActive: true,
      }).select('_id');
      andConditions.push({ specialty: { $in: specialties.map((item) => item._id) } });
    }

    if (req.query.search) {
      const searchRegex = new RegExp(escapeRegex(req.query.search), 'i');
      const [users, specialties] = await Promise.all([
        User.find({ role: 'doctor', name: searchRegex }).select('_id'),
        Specialty.find({ name: searchRegex, isActive: true }).select('_id'),
      ]);

      andConditions.push({
        $or: [
          { user: { $in: users.map((user) => user._id) } },
          { specialty: { $in: specialties.map((item) => item._id) } },
        ],
      });
    }

    if (andConditions.length > 0) {
      filter.$and = andConditions;
    }

    const [matchedDoctors, total] = await Promise.all([
      locationMatches?.point
        ? DoctorProfile.find(filter).populate(doctorPopulate).sort({ createdAt: -1 })
        : DoctorProfile.find(filter)
            .populate(doctorPopulate)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit),
      DoctorProfile.countDocuments(filter),
    ]);

    const formatted = [];
    for (const doctor of matchedDoctors) {
      const clinics = await getClinicsForDoctor(doctor._id, locationMatches);
      formatted.push(formatDoctor(doctor, clinics));
    }
    if (locationMatches?.point) {
      formatted.sort((first, second) =>
        (first.distanceKm ?? Number.POSITIVE_INFINITY) -
        (second.distanceKm ?? Number.POSITIVE_INFINITY)
      );
    }
    const doctors = locationMatches?.point
      ? formatted.slice(skip, skip + limit)
      : formatted;

    return res.status(200).json({
      status: 'success',
      results: doctors.length,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
      data: {
        doctors,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: 'error',
      message: error.message || 'Unable to fetch doctors',
    });
  }
};

export const getDoctorById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid doctor id',
      });
    }

    const doctor = await DoctorProfile.findById(id).populate(doctorPopulate);

    if (!doctor || !doctor.isActive || !doctor.user?.isActive) {
      return res.status(404).json({
        status: 'error',
        message: 'Doctor not found',
      });
    }

    const clinics = await getClinicsForDoctor(doctor._id);

    return res.status(200).json({
      status: 'success',
      data: {
        doctor: formatDoctor(doctor, clinics),
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to fetch doctor',
    });
  }
};

export const getMyDoctorProfile = async (req, res) => {
  try {
    const doctor = await DoctorProfile.findOne({ user: req.user._id }).populate(doctorPopulate);
    if (!doctor || !doctor.isActive) {
      return res.status(404).json({ status: 'error', message: 'Active doctor profile not found' });
    }

    const clinics = await getClinicsForDoctor(doctor._id);
    return res.status(200).json({
      status: 'success',
      data: { doctor: formatDoctor(doctor, clinics) },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to fetch doctor profile',
    });
  }
};

export const createDoctor = async (req, res) => {
  try {
    const validationErrors = validateDoctorInput(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: validationErrors[0],
        errors: validationErrors,
      });
    }

    let targetUserId = req.user._id;

    if (req.user.role === 'doctor') {
      if (req.body.user && String(req.body.user) !== String(req.user._id)) {
        return res.status(403).json({
          status: 'error',
          message: 'Doctors can only create their own profile',
        });
      }
      targetUserId = req.user._id;
    } else if (req.user.role === 'clinic_admin' || req.user.role === 'platform_admin') {
      if (!req.body.user) {
        return res.status(400).json({
          status: 'error',
          message: 'user is required when creating a doctor profile as an admin',
        });
      }
      targetUserId = req.body.user;
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser || !targetUser.isActive) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found',
      });
    }

    if (['clinic_admin', 'platform_admin'].includes(targetUser.role) && req.user.role !== 'platform_admin') {
      return res.status(403).json({
        status: 'error',
        message: 'Cannot create a doctor profile for an admin user',
      });
    }

    if (!['patient', 'doctor'].includes(targetUser.role)) {
      return res.status(400).json({
        status: 'error',
        message: 'Doctor profiles can only be linked to doctor accounts',
      });
    }

    const specialty = await Specialty.findById(req.body.specialty);
    if (!specialty || !specialty.isActive) {
      return res.status(400).json({
        status: 'error',
        message: 'Specialty not found',
      });
    }

    const existingProfile = await DoctorProfile.findOne({ user: targetUserId });
    if (existingProfile) {
      return res.status(409).json({
        status: 'error',
        message: 'Doctor profile already exists for this user',
      });
    }

    if (req.body.clinicId) {
      await assertClinicAssociationAccess({
        clinicId: req.body.clinicId,
        branchId: req.body.branchId,
        actor: req.user,
      });
    }

    const doctor = await DoctorProfile.create({
      user: targetUserId,
      specialty: req.body.specialty,
      qualification: String(req.body.qualification).trim(),
      experienceYears: Number(req.body.experienceYears),
      consultationFee: Number(req.body.consultationFeeInr ?? req.body.consultationFee),
      consultationDurationMinutes: Number(req.body.consultationDurationMinutes || 30),
      languagesSpoken: req.body.languagesSpoken || [],
      bio: req.body.bio ? String(req.body.bio).trim() : '',
      profileImage: req.body.profileImage ? String(req.body.profileImage).trim() : '',
    });

    if (req.body.name !== undefined) targetUser.name = req.body.name.trim();
    if (targetUser.role === 'patient') targetUser.role = 'doctor';
    await targetUser.save();

    if (req.body.clinicId) {
      await associateDoctorWithClinic({
        clinicId: req.body.clinicId,
        doctorId: doctor._id,
        actor: req.user,
        branchId: req.body.branchId,
        weeklySchedule: req.body.weeklySchedule || [],
      });
    }

    const populated = await DoctorProfile.findById(doctor._id).populate(doctorPopulate);
    const clinics = await getClinicsForDoctor(doctor._id);

    return res.status(201).json({
      status: 'success',
      message: 'Doctor profile created successfully',
      data: {
        doctor: formatDoctor(populated, clinics),
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: 'error',
      message: error.message || 'Unable to create doctor profile',
    });
  }
};

export const updateDoctor = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid doctor id',
      });
    }

    const validationErrors = validateDoctorInput(req.body, { partial: true });
    if (validationErrors.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: validationErrors[0],
        errors: validationErrors,
      });
    }

    const doctor = await DoctorProfile.findById(id).populate(doctorPopulate);

    if (!doctor) {
      return res.status(404).json({
        status: 'error',
        message: 'Doctor not found',
      });
    }

    const allowed = await canManageDoctor(req.user, doctor, req.body.clinicId);
    if (!allowed) {
      return res.status(403).json({
        status: 'error',
        message: 'Not authorized to update this doctor profile',
      });
    }

    if (req.user.role === 'doctor' && [
      'specialty',
      'consultationFee',
      'consultationFeeInr',
      'consultationDurationMinutes',
      'isActive',
    ].some((field) => Object.prototype.hasOwnProperty.call(req.body, field))) {
      return res.status(403).json({
        status: 'error',
        message: 'Only an administrator can change specialty, consultation settings, or active status',
      });
    }

    if (req.body.specialty) {
      const specialty = await Specialty.findById(req.body.specialty);
      if (!specialty || !specialty.isActive) {
        return res.status(400).json({
          status: 'error',
          message: 'Specialty not found',
        });
      }
      doctor.specialty = req.body.specialty;
    }

    const updatableFields = ['qualification', 'bio', 'profileImage'];
    for (const field of updatableFields) {
      if (req.body[field] !== undefined) {
        doctor[field] = String(req.body[field]).trim();
      }
    }

    if (req.body.experienceYears !== undefined) {
      doctor.experienceYears = Number(req.body.experienceYears);
    }

    if (req.body.consultationFee !== undefined || req.body.consultationFeeInr !== undefined) {
      doctor.consultationFee = Number(req.body.consultationFeeInr ?? req.body.consultationFee);
    }

    if (req.body.consultationDurationMinutes !== undefined) {
      doctor.consultationDurationMinutes = Number(req.body.consultationDurationMinutes);
    }

    if (req.body.languagesSpoken !== undefined) {
      doctor.languagesSpoken = req.body.languagesSpoken.map((language) => language.trim());
    }

    // Never allow changing linked user through update
    if (req.body.user) {
      return res.status(403).json({
        status: 'error',
        message: 'Cannot reassign the user linked to a doctor profile',
      });
    }

    if (req.user.role === 'doctor' && (
      req.body.weeklySchedule !== undefined ||
      req.body.branchId !== undefined ||
      req.body.clinicAssociationIsActive !== undefined ||
      req.body.clinicId !== undefined
    )) {
      return res.status(403).json({
        status: 'error',
        message: 'Only an authorized clinic admin can change clinic schedules',
      });
    }

    if (req.body.clinicId && req.user.role !== 'doctor') {
      await assertClinicAssociationAccess({
        clinicId: req.body.clinicId,
        branchId: req.body.branchId,
        actor: req.user,
      });
    }

    if (req.body.name !== undefined) {
      const user = await User.findById(doctor.user._id);
      if (!user) {
        return res.status(404).json({ status: 'error', message: 'Doctor user not found' });
      }
      user.name = req.body.name.trim();
      await user.save();
    }

    if (req.body.isActive !== undefined) doctor.isActive = req.body.isActive;

    await doctor.save();

    if (req.body.clinicId) {
      const updateExisting = req.body.weeklySchedule !== undefined ||
        req.body.branchId !== undefined ||
        req.body.clinicAssociationIsActive !== undefined;
      await associateDoctorWithClinic({
        clinicId: req.body.clinicId,
        doctorId: doctor._id,
        actor: req.user,
        branchId: req.body.branchId,
        weeklySchedule: req.body.weeklySchedule,
        associationIsActive: req.body.clinicAssociationIsActive,
        updateExisting,
      });
    }

    const refreshed = await DoctorProfile.findById(doctor._id).populate(doctorPopulate);
    const clinics = await getClinicsForDoctor(doctor._id);

    return res.status(200).json({
      status: 'success',
      message: 'Doctor profile updated successfully',
      data: {
        doctor: formatDoctor(refreshed, clinics),
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: 'error',
      message: error.message || 'Unable to update doctor profile',
    });
  }
};
