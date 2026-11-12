import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import request from 'supertest';
import createApp from '../app.js';
import connectTestDB from './helpers/connectTestDB.js';
import Clinic from '../models/Clinic.js';
import ClinicBranch from '../models/ClinicBranch.js';
import ClinicDoctor from '../models/ClinicDoctor.js';
import DoctorProfile from '../models/DoctorProfile.js';
import Specialty from '../models/Specialty.js';
import User from '../models/User.js';
import generateToken from '../utils/generateToken.js';

dotenv.config();

const app = createApp();
const suffix = Date.now();
const password = 'SecretPassword123';

let clinicAdmin;
let otherClinicAdmin;
let doctorUser;
let patientUser;
let specialty;
let clinic;
let doctorProfile;
let clinicAdminToken;
let otherAdminToken;
let doctorToken;
let patientToken;

before(async () => {
  await connectTestDB();

  clinicAdmin = await User.create({
    name: 'Clinic Admin',
    email: `clinic.admin.${suffix}@healpoint-test.local`,
    password,
    role: 'clinic_admin',
    phone: '555-1000',
  });

  otherClinicAdmin = await User.create({
    name: 'Other Admin',
    email: `other.admin.${suffix}@healpoint-test.local`,
    password,
    role: 'clinic_admin',
    phone: '555-1001',
  });

  doctorUser = await User.create({
    name: 'Dr Strange',
    email: `doctor.${suffix}@healpoint-test.local`,
    password,
    role: 'doctor',
    phone: '555-1002',
  });

  patientUser = await User.create({
    name: 'Patient User',
    email: `patient.clinic.${suffix}@healpoint-test.local`,
    password,
    role: 'patient',
    phone: '555-1003',
  });

  specialty = await Specialty.create({
    name: `Cardiology ${suffix}`,
    description: 'Heart care',
  });

  clinicAdminToken = generateToken(clinicAdmin._id);
  otherAdminToken = generateToken(otherClinicAdmin._id);
  doctorToken = generateToken(doctorUser._id);
  patientToken = generateToken(patientUser._id);
});

after(async () => {
  if (mongoose.connection.readyState !== 1) return;

  const users = await User.find({ email: new RegExp(`${suffix}@healpoint-test\\.local$`, 'i') }).select(
    '_id'
  );
  const userIds = users.map((user) => user._id);
  const doctors = await DoctorProfile.find({ user: { $in: userIds } }).select('_id');
  const doctorIds = doctors.map((doctor) => doctor._id);
  const clinics = await Clinic.find({ createdBy: { $in: userIds } }).select('_id');
  const clinicIds = clinics.map((item) => item._id);

  await ClinicDoctor.deleteMany({
    $or: [{ doctor: { $in: doctorIds } }, { clinic: { $in: clinicIds } }],
  });
  await DoctorProfile.deleteMany({ _id: { $in: doctorIds } });
  await ClinicBranch.deleteMany({ clinic: { $in: clinicIds } });
  await Clinic.deleteMany({ _id: { $in: clinicIds } });
  await Specialty.deleteMany({ name: new RegExp(String(suffix)) });
  await User.deleteMany({ _id: { $in: userIds } });
  await mongoose.disconnect();
});

describe('Clinic and doctor management API', () => {
  it('rejects clinic creation from patients', async () => {
    const response = await request(app)
      .post('/api/clinics/')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        name: 'Unauthorized Clinic',
        email: `clinic.${suffix}@example.com`,
        phone: '555-2000',
        address: '1 Main St',
        city: 'Austin',
        state: 'TX',
        pincode: '73301',
      });

    assert.equal(response.status, 403);
  });

  it('rejects role assignment attempts on clinic create', async () => {
    const response = await request(app)
      .post('/api/clinics/')
      .set('Authorization', `Bearer ${clinicAdminToken}`)
      .send({
        name: 'Role Attempt Clinic',
        email: `role.${suffix}@example.com`,
        phone: '555-2001',
        address: '2 Main St',
        city: 'Austin',
        state: 'TX',
        pincode: '73301',
        role: 'platform_admin',
      });

    assert.equal(response.status, 403);
    assert.match(response.body.message, /cannot assign roles/i);
  });

  it('allows clinic admins to create a clinic with branches', async () => {
    const response = await request(app)
      .post('/api/clinics/')
      .set('Authorization', `Bearer ${clinicAdminToken}`)
      .send({
        name: `HealPoint Clinic ${suffix}`,
        description: 'Primary care clinic',
        email: `healpoint.clinic.${suffix}@example.com`,
        phone: '555-3000',
        address: '100 Health Ave',
        city: 'Austin',
        state: 'TX',
        pincode: '73301',
        location: { type: 'Point', coordinates: [-97.7431, 30.2672] },
        branches: [
          {
            name: 'North Branch',
            address: '200 North Rd',
            city: 'Austin',
            state: 'TX',
            pincode: '73302',
            phone: '555-3001',
            location: { type: 'Point', coordinates: [-97.75, 30.27] },
          },
        ],
      });

    assert.equal(response.status, 201);
    assert.equal(response.body.status, 'success');
    assert.equal(response.body.data.clinic.name, `HealPoint Clinic ${suffix}`);
    assert.equal(response.body.data.clinic.branches.length, 1);
    assert.deepEqual(response.body.data.clinic.location.coordinates, [-97.7431, 30.2672]);
    assert.deepEqual(response.body.data.clinic.branches[0].location.coordinates, [-97.75, 30.27]);
    clinic = response.body.data.clinic;
  });

  it('returns saved clinic and branch coordinates to the authorized admin editor', async () => {
    const response = await request(app)
      .get('/api/admin/clinics')
      .set('Authorization', `Bearer ${clinicAdminToken}`)
      .query({ search: `HealPoint Clinic ${suffix}` });

    assert.equal(response.status, 200);
    const adminClinic = response.body.data.clinics.find((item) => item.id === clinic.id);
    assert.deepEqual(adminClinic.location.coordinates, [-97.7431, 30.2672]);
    assert.deepEqual(adminClinic.branches[0].location.coordinates, [-97.75, 30.27]);
  });

  it('lists active clinics with search and pagination', async () => {
    const response = await request(app).get('/api/clinics/').query({
      search: 'HealPoint',
      city: 'Austin',
      page: 1,
      limit: 5,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'success');
    assert.ok(Array.isArray(response.body.data.clinics));
    assert.ok(response.body.pagination.limit <= 5);
    assert.ok(
      response.body.data.clinics.some((item) => item.id === clinic.id || item.id === clinic._id)
    );
  });

  it('returns a clinic by id', async () => {
    const response = await request(app).get(`/api/clinics/${clinic.id}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.clinic.name, `HealPoint Clinic ${suffix}`);
  });

  it('rejects invalid clinic ids', async () => {
    const response = await request(app).get('/api/clinics/not-a-valid-id');
    assert.equal(response.status, 400);
  });

  it('prevents another clinic admin from updating a clinic they do not own', async () => {
    const response = await request(app)
      .put(`/api/clinics/${clinic.id}`)
      .set('Authorization', `Bearer ${otherAdminToken}`)
      .send({ description: 'Hijack attempt' });

    assert.equal(response.status, 403);
  });

  it('allows the owning clinic admin to update their clinic', async () => {
    const response = await request(app)
      .put(`/api/clinics/${clinic.id}`)
      .set('Authorization', `Bearer ${clinicAdminToken}`)
      .send({ description: 'Updated clinic description' });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.clinic.description, 'Updated clinic description');
  });

  it('updates clinic branch details without creating a duplicate branch', async () => {
    const branch = clinic.branches[0];
    const response = await request(app)
      .put(`/api/clinics/${clinic.id}`)
      .set('Authorization', `Bearer ${clinicAdminToken}`)
      .send({
        branches: [{
          ...branch,
          name: 'North Branch Updated',
          address: '250 North Rd',
        }],
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.clinic.branches.length, 1);
    assert.equal(response.body.data.clinic.branches[0].id, branch.id);
    assert.equal(response.body.data.clinic.branches[0].name, 'North Branch Updated');
    assert.equal(response.body.data.clinic.branches[0].address, '250 North Rd');
  });

  it('allows a doctor to create their own profile', async () => {
    const response = await request(app)
      .post('/api/doctors/')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({
        specialty: specialty._id,
        qualification: 'MD',
        experienceYears: 8,
        consultationFee: 750,
        bio: 'Experienced cardiologist',
      });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.doctor.user.email, doctorUser.email);
    assert.equal(response.body.data.doctor.specialty.name, specialty.name);
    doctorProfile = response.body.data.doctor;
  });

  it('lets doctors read their own profile but not change administrator-controlled settings', async () => {
    const login = await request(app)
      .post('/api/auth/login/')
      .send({ email: doctorUser.email, password });
    assert.equal(login.status, 200);
    assert.equal(login.body.data.user.role, 'doctor');

    const profile = await request(app)
      .get('/api/doctors/me')
      .set('Authorization', `Bearer ${doctorToken}`);
    assert.equal(profile.status, 200);
    assert.equal(profile.body.data.doctor.id, doctorProfile.id);

    const patientDenied = await request(app)
      .get('/api/doctors/me')
      .set('Authorization', `Bearer ${patientToken}`);
    assert.equal(patientDenied.status, 403);

    const forbiddenUpdate = await request(app)
      .put(`/api/doctors/${doctorProfile.id}`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ consultationFeeInr: 0, isActive: false });
    assert.equal(forbiddenUpdate.status, 403);
  });

  it('only lets clinic admins update doctors with an active association to their clinic', async () => {
    const unassociatedUpdate = await request(app)
      .put(`/api/doctors/${doctorProfile.id}`)
      .set('Authorization', `Bearer ${clinicAdminToken}`)
      .send({ clinicId: clinic.id, bio: 'Should not be applied' });

    assert.equal(unassociatedUpdate.status, 403);
    assert.notEqual(unassociatedUpdate.body.data?.doctor?.bio, 'Should not be applied');

    await ClinicDoctor.create({
      clinic: clinic.id,
      doctor: doctorProfile.id,
      isActive: true,
    });

    const response = await request(app)
      .put(`/api/doctors/${doctorProfile.id}`)
      .set('Authorization', `Bearer ${clinicAdminToken}`)
      .send({ clinicId: clinic.id, weeklySchedule: [] });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.doctor.clinics.length, 1);
  });

  it('finds active clinics and associated doctors by city and nearby coordinates', async () => {
    const fallbackClinic = await Clinic.create({
      name: `Nearby Clinic ${suffix}`,
      email: `nearby.clinic.${suffix}@example.com`,
      phone: '555-3003',
      address: 'Nearby Health Ave',
      city: 'Austin',
      state: 'TX',
      pincode: '73304',
      location: { type: 'Point', coordinates: [-97.733, 30.2672] },
      createdBy: clinicAdmin._id,
    });
    const nearbyBranch = await ClinicBranch.create({
      clinic: fallbackClinic._id,
      name: 'Ungeocoded Branch',
      address: 'Nearby Branch Rd',
      city: 'Austin',
      state: 'TX',
      pincode: '73305',
    });
    const nearbyDoctorUser = await User.create({
      name: 'Dr Nearby',
      email: `nearby.doctor.${suffix}@healpoint-test.local`,
      password,
      role: 'doctor',
    });
    const nearbyDoctorProfile = await DoctorProfile.create({
      user: nearbyDoctorUser._id,
      specialty: specialty._id,
      qualification: 'MD',
      experienceYears: 4,
      consultationFee: 650,
    });
    await ClinicDoctor.create({
      clinic: fallbackClinic._id,
      doctor: nearbyDoctorProfile._id,
      branch: nearbyBranch._id,
    });

    const farClinicResponse = await request(app)
      .post('/api/clinics/')
      .set('Authorization', `Bearer ${clinicAdminToken}`)
      .send({
        name: `Far Clinic ${suffix}`,
        email: `far.clinic.${suffix}@example.com`,
        phone: '555-3002',
        address: 'Far Health Ave',
        city: 'Austin',
        state: 'TX',
        pincode: '73303',
        location: { type: 'Point', coordinates: [-97.7431, 30.47] },
      });
    assert.equal(farClinicResponse.status, 201);
    const farClinicId = farClinicResponse.body.data.clinic.id;

    const cityClinics = await request(app).get('/api/clinics/').query({ city: 'Austin' });
    assert.equal(cityClinics.status, 200);
    assert.ok(cityClinics.body.data.clinics.some((item) => item.id === clinic.id));
    const localityClinics = await request(app)
      .get('/api/clinics/')
      .query({ location: 'Nearby Branch Rd' });
    assert.equal(localityClinics.status, 200);
    assert.ok(localityClinics.body.data.clinics.some((item) => item.id === String(fallbackClinic._id)));

    const nearbyClinics = await request(app).get('/api/clinics/').query({
      latitude: 30.2672,
      longitude: -97.7431,
    });
    assert.equal(nearbyClinics.status, 200, nearbyClinics.body.message);
    const nearbyClinic = nearbyClinics.body.data.clinics.find((item) => item.id === clinic.id);
    assert.ok(nearbyClinic);
    assert.ok(!nearbyClinics.body.data.clinics.some((item) => item.id === farClinicId));
    assert.ok(nearbyClinic.distanceKm < 1);
    assert.equal(nearbyClinic.branches.length, 1);
    assert.ok(nearbyClinic.branches[0].distanceKm < 1);
    assert.ok(
      nearbyClinics.body.data.clinics.findIndex((item) => item.id === clinic.id) <
      nearbyClinics.body.data.clinics.findIndex((item) => item.id === String(fallbackClinic._id))
    );
    const nearbyResultClinic = nearbyClinics.body.data.clinics.find(
      (item) => item.id === String(fallbackClinic._id)
    );
    assert.equal(nearbyResultClinic.branches[0].name, 'Ungeocoded Branch');
    assert.ok(nearbyResultClinic.branches[0].distanceKm > 0);

    const nearbyDoctors = await request(app).get('/api/doctors/').query({
      latitude: 30.2672,
      longitude: -97.7431,
    });
    assert.equal(nearbyDoctors.status, 200);
    const nearbyDoctor = nearbyDoctors.body.data.doctors.find((item) => item.id === doctorProfile.id);
    assert.ok(nearbyDoctor);
    assert.equal(nearbyDoctor.specialty.name, specialty.name);
    assert.equal(nearbyDoctor.consultationFeeInr, 750);
    assert.ok(nearbyDoctor.clinics[0].distanceKm < 1);
    const fallbackDoctor = nearbyDoctors.body.data.doctors.find(
      (item) => item.id === String(nearbyDoctorProfile._id)
    );
    assert.ok(fallbackDoctor);
    assert.equal(fallbackDoctor.clinics[0].branch.name, 'Ungeocoded Branch');
    assert.ok(fallbackDoctor.clinics[0].distanceKm > 0);
    assert.ok(
      nearbyDoctors.body.data.doctors.findIndex((item) => item.id === doctorProfile.id) <
      nearbyDoctors.body.data.doctors.findIndex((item) => item.id === String(nearbyDoctorProfile._id))
    );
  });

  it('validates nearby search coordinates and radius', async () => {
    const missingCoordinate = await request(app).get('/api/clinics/').query({ latitude: 30 });
    assert.equal(missingCoordinate.status, 400);

    const outOfRange = await request(app).get('/api/doctors/').query({
      latitude: 30,
      longitude: -97,
      radiusKm: 201,
    });
    assert.equal(outOfRange.status, 400);

    const invalidClinicLocation = await request(app)
      .put(`/api/clinics/${clinic.id}`)
      .set('Authorization', `Bearer ${clinicAdminToken}`)
      .send({ location: { type: 'Point', coordinates: [-181, 30] } });
    assert.equal(invalidClinicLocation.status, 400);
  });

  it('updates consultation details and clinic hours with IST schedule validation', async () => {
    const weeklySchedule = [
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' },
      { dayOfWeek: 3, startTime: '10:00', endTime: '16:00' },
    ];
    const response = await request(app)
      .put(`/api/doctors/${doctorProfile.id}`)
      .set('Authorization', `Bearer ${clinicAdminToken}`)
      .send({
        specialty: specialty._id,
        consultationFeeInr: 900,
        consultationDurationMinutes: 45,
        languagesSpoken: ['English', 'Hindi'],
        clinicId: clinic.id,
        branchId: clinic.branches[0].id,
        weeklySchedule,
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.doctor.consultationFeeInr, 900);
    assert.equal(response.body.data.doctor.consultationDurationMinutes, 45);
    assert.deepEqual(response.body.data.doctor.languagesSpoken, ['English', 'Hindi']);
    assert.deepEqual(response.body.data.doctor.clinics[0].weeklySchedule, weeklySchedule);
    assert.equal(response.body.data.doctor.clinics[0].branch.id, clinic.branches[0].id);

    const nearbyDoctors = await request(app).get('/api/doctors/').query({
      latitude: 30.27,
      longitude: -97.75,
    });
    assert.equal(nearbyDoctors.status, 200);
    const nearbyDoctor = nearbyDoctors.body.data.doctors.find((item) => item.id === doctorProfile.id);
    assert.ok(nearbyDoctor);
    assert.equal(nearbyDoctor.consultationFeeInr, 900);
    assert.equal(nearbyDoctor.clinics[0].branch.name, 'North Branch Updated');
    assert.ok(nearbyDoctor.clinics[0].distanceKm < 1);
  });

  it('prevents duplicate clinic-doctor associations', async () => {
    const response = await request(app)
      .put(`/api/doctors/${doctorProfile.id}`)
      .set('Authorization', `Bearer ${clinicAdminToken}`)
      .send({ clinicId: clinic.id });

    assert.equal(response.status, 409);
    assert.match(response.body.message, /already associated/i);
  });

  it('lists doctors with specialty and name search', async () => {
    const response = await request(app).get('/api/doctors/').query({
      name: 'Strange',
      specialty: 'Cardiology',
      page: 1,
      limit: 10,
    });

    assert.equal(response.status, 200);
    assert.ok(response.body.data.doctors.some((item) => item.id === doctorProfile.id));
  });

  it('returns a doctor by id', async () => {
    const response = await request(app).get(`/api/doctors/${doctorProfile.id}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.data.doctor.qualification, 'MD');
  });

  it('does not expose inactive doctor accounts in public search or details', async () => {
    await User.updateOne({ _id: doctorUser._id }, { $set: { isActive: false } });
    try {
      const listing = await request(app).get('/api/doctors/').query({ search: 'Strange' });
      assert.equal(listing.status, 200);
      assert.ok(!listing.body.data.doctors.some((item) => item.id === doctorProfile.id));

      const details = await request(app).get(`/api/doctors/${doctorProfile.id}`);
      assert.equal(details.status, 404);
    } finally {
      await User.updateOne({ _id: doctorUser._id }, { $set: { isActive: true } });
    }
  });

  it('rejects unauthorized doctor profile creation by patients', async () => {
    const response = await request(app)
      .post('/api/doctors/')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        specialty: specialty._id,
        qualification: 'MBBS',
        experienceYears: 1,
        consultationFee: 100,
      });

    assert.equal(response.status, 403);
  });

  it('allows clinic admins to create a doctor profile for a user and link their clinic', async () => {
    const staffUser = await User.create({
      name: 'Dr Staff',
      email: `staff.doctor.${suffix}@healpoint-test.local`,
      password,
      role: 'patient',
      phone: '555-4000',
    });

    const response = await request(app)
      .post('/api/doctors/')
      .set('Authorization', `Bearer ${clinicAdminToken}`)
      .send({
        user: staffUser._id,
        specialty: specialty._id,
        qualification: 'MBBS',
        experienceYears: 3,
        consultationFee: 400,
        clinicId: clinic.id,
      });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.doctor.user.role, 'doctor');
    assert.equal(response.body.data.doctor.clinics.length, 1);

    const refreshed = await User.findById(staffUser._id);
    assert.equal(refreshed.role, 'doctor');
  });

  it('keeps health endpoint working', async () => {
    const response = await request(app).get('/api/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.message, 'HealPoint API is running');
  });
});
