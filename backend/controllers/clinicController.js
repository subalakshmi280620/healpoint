import Clinic from '../models/Clinic.js';
import ClinicBranch from '../models/ClinicBranch.js';
import { escapeRegex, isValidObjectId, parsePagination } from '../utils/mongo.js';
import { findLocationMatches } from '../utils/locationSearch.js';
import { isClinicAdminForClinic } from '../utils/clinicAccess.js';
import { validateClinicInput } from '../utils/validateClinicDoctor.js';

const buildClinicFilter = (query = {}) => {
  const filter = { isActive: true };

  if (query.name) {
    filter.name = new RegExp(escapeRegex(query.name), 'i');
  }

  if (query.search) {
    const searchRegex = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: searchRegex }, { city: searchRegex }];
  }

  return filter;
};

const formatClinic = (clinic, branches = [], locationMatches = null) => {
  const data = clinic.toObject({ virtuals: true });
  return {
    id: data._id,
    name: data.name,
    description: data.description,
    email: data.email,
    phone: data.phone,
    address: data.address,
    city: data.city,
    state: data.state,
    pincode: data.pincode,
    location: data.location || null,
    distanceKm: locationMatches?.clinicDistances.get(String(data._id)) ?? null,
    logo: data.logo,
    isActive: data.isActive,
    createdBy: data.createdBy,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    branches: branches
      .filter((branch) =>
        !locationMatches ||
        locationMatches.branchIds.has(String(branch._id)) ||
        (
          locationMatches.point &&
          !branch.location &&
          locationMatches.directClinicIds.has(String(branch.clinic))
        )
      )
      .map((branch) => ({
        id: branch._id,
        name: branch.name,
        address: branch.address,
        city: branch.city,
        state: branch.state,
        pincode: branch.pincode,
        phone: branch.phone,
        isActive: branch.isActive,
        location: branch.location || null,
        distanceKm:
          locationMatches?.branchDistances.get(String(branch._id)) ??
          (locationMatches?.point && !branch.location
            ? locationMatches.clinicDistances.get(String(branch.clinic)) ?? null
            : null),
      })),
  };
};

const canManageClinic = (user, clinic) => {
  if (user.role === 'platform_admin') {
    return true;
  }

  if (user.role === 'clinic_admin') {
    return isClinicAdminForClinic(user, clinic);
  }

  return false;
};

export const getClinics = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = buildClinicFilter(req.query);
    const locationMatches = await findLocationMatches(req.query);
    if (locationMatches) {
      filter._id = { $in: locationMatches.clinicIds };
    }

    const [matchedClinics, total] = await Promise.all([
      locationMatches?.point
        ? Clinic.find(filter).sort({ createdAt: -1 })
        : Clinic.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Clinic.countDocuments(filter),
    ]);
    const clinics = locationMatches?.point
      ? matchedClinics
          .sort((first, second) =>
            locationMatches.clinicDistances.get(String(first._id)) -
            locationMatches.clinicDistances.get(String(second._id))
          )
          .slice(skip, skip + limit)
      : matchedClinics;

    const clinicIds = clinics.map((clinic) => clinic._id);
    const branches = await ClinicBranch.find({
      clinic: { $in: clinicIds },
      isActive: true,
    });

    const branchesByClinic = branches.reduce((acc, branch) => {
      const key = String(branch.clinic);
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(branch);
      return acc;
    }, {});

    return res.status(200).json({
      status: 'success',
      results: clinics.length,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
      data: {
        clinics: clinics.map((clinic) =>
          formatClinic(clinic, branchesByClinic[String(clinic._id)] || [], locationMatches)
        ),
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: 'error',
      message: error.message || 'Unable to fetch clinics',
    });
  }
};

export const getClinicById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid clinic id',
      });
    }

    const clinic = await Clinic.findById(id);

    if (!clinic || !clinic.isActive) {
      return res.status(404).json({
        status: 'error',
        message: 'Clinic not found',
      });
    }

    const branches = await ClinicBranch.find({ clinic: clinic._id, isActive: true });

    return res.status(200).json({
      status: 'success',
      data: {
        clinic: formatClinic(clinic, branches),
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to fetch clinic',
    });
  }
};

export const createClinic = async (req, res) => {
  try {
    const validationErrors = validateClinicInput(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: validationErrors[0],
        errors: validationErrors,
      });
    }

    const clinic = await Clinic.create({
      name: String(req.body.name).trim(),
      description: req.body.description ? String(req.body.description).trim() : '',
      email: String(req.body.email).trim().toLowerCase(),
      phone: String(req.body.phone).trim(),
      address: String(req.body.address).trim(),
      city: String(req.body.city).trim(),
      state: String(req.body.state).trim(),
      pincode: String(req.body.pincode).trim(),
      logo: req.body.logo ? String(req.body.logo).trim() : '',
      ...(req.body.location ? { location: req.body.location } : {}),
      createdBy: req.user._id,
    });

    let branches = [];
    if (Array.isArray(req.body.branches) && req.body.branches.length > 0) {
      branches = await ClinicBranch.insertMany(
        req.body.branches.map((branch) => ({
          clinic: clinic._id,
          name: String(branch.name).trim(),
          address: String(branch.address).trim(),
          city: String(branch.city).trim(),
          state: String(branch.state).trim(),
          pincode: String(branch.pincode).trim(),
          phone: branch.phone ? String(branch.phone).trim() : '',
          ...(branch.location ? { location: branch.location } : {}),
        }))
      );
    }

    return res.status(201).json({
      status: 'success',
      message: 'Clinic created successfully',
      data: {
        clinic: formatClinic(clinic, branches),
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to create clinic',
    });
  }
};

export const updateClinic = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid clinic id',
      });
    }

    const validationErrors = validateClinicInput(req.body, { partial: true });
    if (validationErrors.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: validationErrors[0],
        errors: validationErrors,
      });
    }

    const clinic = await Clinic.findById(id);

    if (!clinic) {
      return res.status(404).json({
        status: 'error',
        message: 'Clinic not found',
      });
    }

    if (!canManageClinic(req.user, clinic)) {
      return res.status(403).json({
        status: 'error',
        message: 'Not authorized to update this clinic',
      });
    }

    if (Array.isArray(req.body.branches)) {
      const branchNames = new Set();
      for (const branch of req.body.branches) {
        const name = String(branch.name).trim();
        if (branchNames.has(name)) {
          return res.status(409).json({
            status: 'error',
            message: 'Branch names must be unique within a clinic',
          });
        }
        branchNames.add(name);
        if (branch.id && !(await ClinicBranch.exists({ _id: branch.id, clinic: clinic._id }))) {
          return res.status(400).json({
            status: 'error',
            message: 'A branch must belong to the selected clinic',
          });
        }
        const sameName = await ClinicBranch.exists({
          clinic: clinic._id,
          name,
          ...(branch.id ? { _id: { $ne: branch.id } } : {}),
        });
        if (sameName) {
          return res.status(409).json({
            status: 'error',
            message: 'A branch with that name already exists in this clinic',
          });
        }
      }
    }

    const updatableFields = [
      'name',
      'description',
      'email',
      'phone',
      'address',
      'city',
      'state',
      'pincode',
      'logo',
      'isActive',
      'location',
    ];

    for (const field of updatableFields) {
      if (req.body[field] !== undefined) {
        if (field === 'email') {
          clinic.email = String(req.body.email).trim().toLowerCase();
        } else if (field === 'isActive') {
          clinic.isActive = Boolean(req.body.isActive);
        } else if (field === 'location') {
          clinic.location = req.body.location || undefined;
        } else {
          clinic[field] = String(req.body[field]).trim();
        }
      }
    }

    await clinic.save();

    if (Array.isArray(req.body.branches)) {
      for (const branch of req.body.branches) {
        const branchFilter = branch.id
          ? { _id: branch.id, clinic: clinic._id }
          : { clinic: clinic._id, name: String(branch.name).trim() };
        try {
          const branchUpdate = {
            clinic: clinic._id,
            name: String(branch.name).trim(),
            address: String(branch.address).trim(),
            city: String(branch.city).trim(),
            state: String(branch.state).trim(),
            pincode: String(branch.pincode).trim(),
            phone: branch.phone ? String(branch.phone).trim() : '',
            isActive: branch.isActive === undefined ? true : Boolean(branch.isActive),
          };
          if (branch.location) {
            branchUpdate.location = branch.location;
          }
          await ClinicBranch.findOneAndUpdate(
            branchFilter,
            branch.location === null
              ? { $set: branchUpdate, $unset: { location: 1 } }
              : branchUpdate,
            { upsert: !branch.id, new: true, setDefaultsOnInsert: true }
          );
        } catch (error) {
          if (error.code === 11000) {
            error.statusCode = 409;
            error.message = 'A branch with that name already exists in this clinic';
          }
          throw error;
        }
      }
    }

    const branches = await ClinicBranch.find({ clinic: clinic._id, isActive: true });

    return res.status(200).json({
      status: 'success',
      message: 'Clinic updated successfully',
      data: {
        clinic: formatClinic(clinic, branches),
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      status: 'error',
      message: error.message || 'Unable to update clinic',
    });
  }
};
