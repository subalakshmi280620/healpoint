import Clinic from '../models/Clinic.js';
import ClinicBranch from '../models/ClinicBranch.js';
import { escapeRegex } from './mongo.js';

const EARTH_RADIUS_KM = 6371;
const DEFAULT_RADIUS_KM = 20;
const MAX_RADIUS_KM = 200;

const getDistanceKm = (first, second) => {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const [firstLng, firstLat] = first;
  const [secondLng, secondLat] = second;
  const latitudeDelta = toRadians(secondLat - firstLat);
  const longitudeDelta = toRadians(secondLng - firstLng);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(firstLat)) *
      Math.cos(toRadians(secondLat)) *
      Math.sin(longitudeDelta / 2) ** 2;

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

const getPointCoordinates = (location) =>
  location?.type === 'Point' && Array.isArray(location.coordinates)
    ? location.coordinates
    : null;

export const parseGeoPoint = (value, fieldName = 'location') => {
  if (value === undefined || value === null) {
    return value;
  }
  if (
    value?.type !== 'Point' ||
    !Array.isArray(value.coordinates) ||
    value.coordinates.length !== 2
  ) {
    return `${fieldName} must be a GeoJSON Point with [longitude, latitude] coordinates`;
  }
  const [longitude, latitude] = value.coordinates.map((coordinate) =>
    typeof coordinate === 'number' ||
    (typeof coordinate === 'string' && coordinate.trim() !== '')
      ? Number(coordinate)
      : Number.NaN
  );
  if (
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    return `${fieldName} coordinates are out of range`;
  }
  return { type: 'Point', coordinates: [longitude, latitude] };
};

const parseSearchPoint = (query) => {
  const hasLatitude = query.latitude !== undefined && query.latitude !== '';
  const hasLongitude = query.longitude !== undefined && query.longitude !== '';

  if (hasLatitude !== hasLongitude) {
    const error = new Error('latitude and longitude must be provided together');
    error.statusCode = 400;
    throw error;
  }
  if (!hasLatitude) return null;

  const latitude = typeof query.latitude === 'string' && query.latitude.trim()
    ? Number(query.latitude)
    : Number.NaN;
  const longitude = typeof query.longitude === 'string' && query.longitude.trim()
    ? Number(query.longitude)
    : Number.NaN;
  const radiusKm = query.radiusKm === undefined ? DEFAULT_RADIUS_KM : Number(query.radiusKm);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    const error = new Error('latitude or longitude is out of range');
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > MAX_RADIUS_KM) {
    const error = new Error(`radiusKm must be greater than 0 and no more than ${MAX_RADIUS_KM}`);
    error.statusCode = 400;
    throw error;
  }

  return { latitude, longitude, radiusKm };
};

export const findLocationMatches = async (query = {}) => {
  const rawLocation = query.location ?? query.city;
  if (rawLocation !== undefined && typeof rawLocation !== 'string') {
    const error = new Error('location must be a text value');
    error.statusCode = 400;
    throw error;
  }
  const locationText = rawLocation?.trim() || '';
  const point = parseSearchPoint(query);

  if (!point && !locationText) return null;
  if (locationText.length > 100) {
    const error = new Error('location must be 100 characters or fewer');
    error.statusCode = 400;
    throw error;
  }

  let clinics;
  let branches;
  if (point) {
    const geometry = {
      type: 'Point',
      coordinates: [point.longitude, point.latitude],
    };
    const maxDistance = point.radiusKm * 1000;
    [clinics, branches] = await Promise.all([
      Clinic.find({
        isActive: true,
        location: { $near: { $geometry: geometry, $maxDistance: maxDistance } },
      }).select('_id location'),
      ClinicBranch.find({
        isActive: true,
        location: { $near: { $geometry: geometry, $maxDistance: maxDistance } },
      }).select('_id clinic location'),
    ]);

    clinics = clinics.map((clinic) => ({
      id: String(clinic._id),
      distanceKm: getDistanceKm(
        geometry.coordinates,
        getPointCoordinates(clinic.location)
      ),
    }));
    branches = branches.map((branch) => ({
      id: String(branch._id),
      clinicId: String(branch.clinic),
      distanceKm: getDistanceKm(
        geometry.coordinates,
        getPointCoordinates(branch.location)
      ),
    }));
  } else {
    const searchRegex = new RegExp(escapeRegex(locationText), 'i');
    [clinics, branches] = await Promise.all([
      Clinic.find({
        isActive: true,
        $or: [{ city: searchRegex }, { address: searchRegex }, { state: searchRegex }],
      }).select('_id'),
      ClinicBranch.find({
        isActive: true,
        $or: [{ city: searchRegex }, { address: searchRegex }, { state: searchRegex }],
      }).select('_id clinic'),
    ]);
    clinics = clinics.map((clinic) => ({ id: String(clinic._id), distanceKm: null }));
    branches = branches.map((branch) => ({
      id: String(branch._id),
      clinicId: String(branch.clinic),
      distanceKm: null,
    }));
  }

  const directClinicIds = new Set(clinics.map((clinic) => clinic.id));
  const branchIds = new Set(branches.map((branch) => branch.id));
  const clinicDistances = new Map(
    clinics.map((clinic) => [clinic.id, clinic.distanceKm])
  );
  const branchDistances = new Map(
    branches.map((branch) => [branch.id, branch.distanceKm])
  );
  for (const branch of branches) {
    const existing = clinicDistances.get(branch.clinicId);
    if (
      existing === undefined ||
      existing === null ||
      (branch.distanceKm !== null && branch.distanceKm < existing)
    ) {
      clinicDistances.set(branch.clinicId, branch.distanceKm);
    }
  }

  return {
    point,
    clinicIds: [...new Set([...directClinicIds, ...branches.map((branch) => branch.clinicId)])],
    directClinicIds,
    branchIds,
    clinicDistances,
    branchDistances,
  };
};

export const isAssociationInLocationMatches = (association, matches) => {
  if (!matches) return true;
  if (association.branch) {
    const branchId = String(association.branch._id || association.branch);
    if (matches.branchIds.has(branchId)) return true;
    return Boolean(
      matches.point &&
      !association.branch.location &&
      matches.directClinicIds.has(String(association.clinic._id || association.clinic))
    );
  }
  return matches.directClinicIds.has(String(association.clinic._id || association.clinic));
};

export const getAssociationDistanceKm = (association, matches) => {
  if (!matches) return null;
  if (association.branch) {
    const branchDistance = matches.branchDistances.get(
      String(association.branch._id || association.branch)
    );
    if (branchDistance !== undefined) return branchDistance;
    if (matches.point && !association.branch.location) {
      return matches.clinicDistances.get(String(association.clinic._id || association.clinic)) ?? null;
    }
    return null;
  }
  return matches.clinicDistances.get(String(association.clinic._id || association.clinic)) ?? null;
};
