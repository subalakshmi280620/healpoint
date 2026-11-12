import { isValidObjectId } from './mongo.js';
import { parseGeoPoint } from './locationSearch.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isQuarterHourTime = (value) =>
  typeof value === 'string' &&
  /^([01]\d|2[0-3]):[0-5]\d$/.test(value) &&
  Number(value.slice(3)) % 15 === 0;

const validateWeeklySchedule = (schedule) => {
  const errors = [];
  if (!Array.isArray(schedule) || schedule.length > 42) {
    return ['weeklySchedule must contain at most 42 schedule windows'];
  }

  const windowsByDay = new Map();
  schedule.forEach((window, index) => {
    if (!Number.isInteger(window?.dayOfWeek) || window.dayOfWeek < 0 || window.dayOfWeek > 6) {
      errors.push(`weeklySchedule[${index}].dayOfWeek must be between 0 and 6`);
      return;
    }
    if (!isQuarterHourTime(window.startTime) || !isQuarterHourTime(window.endTime)) {
      errors.push(`weeklySchedule[${index}] times must use 15-minute HH:mm values`);
      return;
    }
    const start = Number(window.startTime.slice(0, 2)) * 60 + Number(window.startTime.slice(3));
    const end = Number(window.endTime.slice(0, 2)) * 60 + Number(window.endTime.slice(3));
    if (start >= end) {
      errors.push(`weeklySchedule[${index}] endTime must be later than startTime`);
      return;
    }
    const windows = windowsByDay.get(window.dayOfWeek) || [];
    if (windows.some((existing) => start < existing.end && end > existing.start)) {
      errors.push(`weeklySchedule[${index}] overlaps another window for that day`);
    }
    windows.push({ start, end });
    windowsByDay.set(window.dayOfWeek, windows);
  });
  return errors;
};

export const validateClinicInput = (body = {}, { partial = false } = {}) => {
  const errors = [];
  const requiredFields = ['name', 'email', 'phone', 'address', 'city', 'state', 'pincode'];

  for (const field of requiredFields) {
    if (!partial || body[field] !== undefined) {
      if (!body[field] || !String(body[field]).trim()) {
        errors.push(`${field} is required`);
      }
    }
  }

  if (body.email !== undefined && body.email && !EMAIL_REGEX.test(String(body.email).trim().toLowerCase())) {
    errors.push('Email format is invalid');
  }

  if (body.location !== undefined) {
    const locationError = parseGeoPoint(body.location, 'location');
    if (typeof locationError === 'string') errors.push(locationError);
  }

  if (body.branches !== undefined) {
    if (!Array.isArray(body.branches)) {
      errors.push('branches must be an array');
    } else {
      body.branches.forEach((branch, index) => {
        ['name', 'address', 'city', 'state', 'pincode'].forEach((field) => {
          if (!branch?.[field] || !String(branch[field]).trim()) {
            errors.push(`branches[${index}].${field} is required`);
          }
        });
        if (branch?.id !== undefined && !isValidObjectId(branch.id)) {
          errors.push(`branches[${index}].id must be a valid MongoDB id`);
        }
        if (branch?.isActive !== undefined && typeof branch.isActive !== 'boolean') {
          errors.push(`branches[${index}].isActive must be a boolean`);
        }
        if (branch?.location !== undefined) {
          const locationError = parseGeoPoint(branch.location, `branches[${index}].location`);
          if (typeof locationError === 'string') errors.push(locationError);
        }
      });
    }
  }

  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
    errors.push('isActive must be a boolean');
  }

  return errors;
};

export const validateDoctorInput = (body = {}, { partial = false } = {}) => {
  const errors = [];

  if (!partial || body.specialty !== undefined) {
    if (!body.specialty || !isValidObjectId(body.specialty)) {
      errors.push('A valid specialty id is required');
    }
  }

  if (!partial || body.qualification !== undefined) {
    if (!body.qualification || !String(body.qualification).trim()) {
      errors.push('qualification is required');
    }
  }

  if (!partial || body.experienceYears !== undefined) {
    if (body.experienceYears === undefined || body.experienceYears === null || body.experienceYears === '') {
      errors.push('experienceYears is required');
    } else if (Number.isNaN(Number(body.experienceYears)) || Number(body.experienceYears) < 0) {
      errors.push('experienceYears must be a non-negative number');
    }
  }

  const consultationFee = body.consultationFeeInr ?? body.consultationFee;
  if (!partial || body.consultationFee !== undefined || body.consultationFeeInr !== undefined) {
    if (consultationFee === undefined || consultationFee === null || consultationFee === '') {
      errors.push('consultationFeeInr is required');
    } else if (!Number.isFinite(Number(consultationFee)) || Number(consultationFee) < 0) {
      errors.push('consultationFeeInr must be a non-negative number');
    }
  }

  if (body.consultationDurationMinutes !== undefined) {
    const duration = Number(body.consultationDurationMinutes);
    if (!Number.isInteger(duration) || duration < 15 || duration > 240 || duration % 15 !== 0) {
      errors.push('consultationDurationMinutes must be a multiple of 15 between 15 and 240');
    }
  }

  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length < 2)) {
    errors.push('name must contain at least 2 characters');
  }

  if (body.isActive !== undefined && typeof body.isActive !== 'boolean') {
    errors.push('isActive must be a boolean');
  }
  if (
    body.clinicAssociationIsActive !== undefined &&
    typeof body.clinicAssociationIsActive !== 'boolean'
  ) {
    errors.push('clinicAssociationIsActive must be a boolean');
  }

  if (body.languagesSpoken !== undefined) {
    if (!Array.isArray(body.languagesSpoken) || body.languagesSpoken.length > 10) {
      errors.push('languagesSpoken must be an array with at most 10 entries');
    } else if (body.languagesSpoken.some((language) =>
      typeof language !== 'string' || !language.trim() || language.trim().length > 50
    )) {
      errors.push('Each language must be between 1 and 50 characters');
    }
  }

  if (body.weeklySchedule !== undefined) {
    errors.push(...validateWeeklySchedule(body.weeklySchedule));
  }

  if (body.user !== undefined && body.user && !isValidObjectId(body.user)) {
    errors.push('user must be a valid MongoDB id');
  }

  if (body.clinicId !== undefined && body.clinicId && !isValidObjectId(body.clinicId)) {
    errors.push('clinicId must be a valid MongoDB id');
  }

  if (body.branchId !== undefined && body.branchId && !isValidObjectId(body.branchId)) {
    errors.push('branchId must be a valid MongoDB id');
  }
  if (
    (body.branchId !== undefined ||
      body.weeklySchedule !== undefined ||
      body.clinicAssociationIsActive !== undefined) &&
    !body.clinicId
  ) {
    errors.push('clinicId is required when updating branch or schedule settings');
  }

  return errors;
};
