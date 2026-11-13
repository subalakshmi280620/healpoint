import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import request from 'supertest';
import createApp from '../app.js';
import connectTestDB from './helpers/connectTestDB.js';
import Appointment from '../models/Appointment.js';
import Clinic from '../models/Clinic.js';
import ClinicDoctor from '../models/ClinicDoctor.js';
import DoctorProfile from '../models/DoctorProfile.js';
import Notification from '../models/Notification.js';
import Specialty from '../models/Specialty.js';
import User from '../models/User.js';
import generateToken from '../utils/generateToken.js';

dotenv.config();

const app = createApp();
const suffix = Date.now();
const password = 'SecretPassword123';

let platformAdmin;
let clinicAdmin;
let otherClinicAdmin;
let assignedClinicAdmin;
let doctorUser;
let otherDoctorUser;
let patient;
let otherPatient;
let specialty;
let clinic;
let otherClinic;
let doctor;
let otherDoctor;
let clinicDoctor;
let otherClinicDoctor;
let sharedClinicDoctor;
let appointment;
let otherAppointment;
let sharedAppointment;
let legacyAppointment;
let platformToken;
let clinicToken;
let patientToken;
let otherPatientToken;
let doctorToken;
let assignedClinicAdminToken;

const futureSlot = (hours) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 2);
  date.setUTCHours(hours, 0, 0, 0);
  return date;
};

const makeClinic = (name, createdBy) =>
  Clinic.create({
    name,
    email: `${name}.${suffix}@healpoint-test.local`,
    phone: '555-5000',
    address: '1 Admin Way',
    city: 'Austin',
    state: 'TX',
    pincode: '73301',
    createdBy,
  });

const makeDoctor = (user, specialtyId) =>
  DoctorProfile.create({
    user,
    specialty: specialtyId,
    qualification: 'MD',
    experienceYears: 5,
    consultationFee: 200,
  });

before(async () => {
  await connectTestDB();
  await Appointment.init();

  [
    platformAdmin,
    clinicAdmin,
    otherClinicAdmin,
    doctorUser,
    otherDoctorUser,
    patient,
    otherPatient,
    specialty,
  ] = await Promise.all([
    User.create({
      name: 'Platform Admin',
      email: `platform.${suffix}@healpoint-test.local`,
      password,
      role: 'platform_admin',
    }),
    User.create({
      name: 'Clinic Admin One',
      email: `clinic-admin-one.${suffix}@healpoint-test.local`,
      password,
      role: 'clinic_admin',
    }),
    User.create({
      name: 'Clinic Admin Two',
      email: `clinic-admin-two.${suffix}@healpoint-test.local`,
      password,
      role: 'clinic_admin',
    }),
    User.create({
      name: 'Admin Doctor One',
      email: `admin-doctor-one.${suffix}@healpoint-test.local`,
      password,
      role: 'doctor',
    }),
    User.create({
      name: 'Admin Doctor Two',
      email: `admin-doctor-two.${suffix}@healpoint-test.local`,
      password,
      role: 'doctor',
    }),
    User.create({
      name: 'Clinic Patient One',
      email: `clinic-patient-one.${suffix}@healpoint-test.local`,
      password,
      role: 'patient',
    }),
    User.create({
      name: 'Clinic Patient Two',
      email: `clinic-patient-two.${suffix}@healpoint-test.local`,
      password,
      role: 'patient',
    }),
    Specialty.create({ name: `Admin Specialty ${suffix}` }),
  ]);

  [clinic, otherClinic] = await Promise.all([
    makeClinic(`Admin Clinic One ${suffix}`, clinicAdmin._id),
    makeClinic(`Admin Clinic Two ${suffix}`, otherClinicAdmin._id),
  ]);
  [doctor, otherDoctor] = await Promise.all([
    makeDoctor(doctorUser._id, specialty._id),
    makeDoctor(otherDoctorUser._id, specialty._id),
  ]);
  [clinicDoctor, otherClinicDoctor] = await ClinicDoctor.create([
    { clinic: clinic._id, doctor: doctor._id },
    { clinic: otherClinic._id, doctor: otherDoctor._id },
  ]);
  [sharedClinicDoctor] = await ClinicDoctor.create([
    { clinic: otherClinic._id, doctor: doctor._id },
  ]);

  [appointment, otherAppointment, sharedAppointment, legacyAppointment] = await Promise.all([
    Appointment.create({
      patient: patient._id,
      doctor: doctor._id,
      clinic: clinic._id,
      clinicDoctor: clinicDoctor._id,
      startAt: futureSlot(13),
      endAt: new Date(futureSlot(13).getTime() + 30 * 60 * 1000),
    }),
    Appointment.create({
      patient: otherPatient._id,
      doctor: otherDoctor._id,
      clinic: otherClinic._id,
      clinicDoctor: otherClinicDoctor._id,
      startAt: futureSlot(14),
      endAt: new Date(futureSlot(14).getTime() + 30 * 60 * 1000),
    }),
    Appointment.create({
      patient: otherPatient._id,
      doctor: doctor._id,
      clinic: otherClinic._id,
      clinicDoctor: sharedClinicDoctor._id,
      startAt: futureSlot(15),
      endAt: new Date(futureSlot(15).getTime() + 30 * 60 * 1000),
    }),
    Appointment.create({
      patient: patient._id,
      doctor: doctor._id,
      clinicDoctor: clinicDoctor._id,
      startAt: futureSlot(16),
      endAt: new Date(futureSlot(16).getTime() + 30 * 60 * 1000),
    }),
  ]);

  platformToken = generateToken(platformAdmin._id);
  clinicToken = generateToken(clinicAdmin._id);
  patientToken = generateToken(patient._id);
  otherPatientToken = generateToken(otherPatient._id);
  doctorToken = generateToken(doctorUser._id);
});

after(async () => {
  if (mongoose.connection.readyState !== 1) return;

  await Notification.deleteMany({
    appointment: {
      $in: [
        appointment?._id,
        otherAppointment?._id,
        sharedAppointment?._id,
        legacyAppointment?._id,
      ].filter(Boolean),
    },
  });
  const doctorIds = [doctor?._id, otherDoctor?._id].filter(Boolean);
  const clinicIds = [clinic?._id, otherClinic?._id].filter(Boolean);
  if (doctorIds.length) {
    await Appointment.deleteMany({ doctor: { $in: doctorIds } });
    await ClinicDoctor.deleteMany({ doctor: { $in: doctorIds } });
    await DoctorProfile.deleteMany({ _id: { $in: doctorIds } });
  }
  if (clinicIds.length) {
    await ClinicDoctor.deleteMany({ clinic: { $in: clinicIds } });
    await Clinic.deleteMany({ _id: { $in: clinicIds } });
  }
  if (specialty) await Specialty.deleteOne({ _id: specialty._id });
  const userIds = [
    platformAdmin?._id,
    clinicAdmin?._id,
    otherClinicAdmin?._id,
    assignedClinicAdmin?._id,
    doctorUser?._id,
    otherDoctorUser?._id,
    patient?._id,
    otherPatient?._id,
  ].filter(Boolean);
  if (userIds.length) await User.deleteMany({ _id: { $in: userIds } });
  await mongoose.disconnect();
});

describe('Admin dashboard APIs', () => {
  it('requires an authenticated admin and blocks public admin registration', async () => {
    const unauthenticated = await request(app).get('/api/admin/clinics');
    assert.equal(unauthenticated.status, 401);

    const forbidden = await request(app)
      .get('/api/admin/clinics')
      .set('Authorization', `Bearer ${patientToken}`);
    assert.equal(forbidden.status, 403);

    for (const role of ['doctor', 'clinic_admin', 'platform_admin']) {
      const registration = await request(app)
        .post('/api/auth/register/')
        .send({
          name: 'Attempt Admin',
          email: `public-attempt-${role}-${suffix}@healpoint-test.local`,
          password,
          role,
        });
      assert.equal(registration.status, 403);
    }
  });

  it('creates doctor accounts only for authorized admins and includes them as profile candidates', async () => {
    const accountEmail = `new-doctor.${suffix}@healpoint-test.local`;
    const weakPasswordCreate = await request(app)
      .post('/api/admin/doctor-accounts')
      .set('Authorization', `Bearer ${clinicToken}`)
      .send({
        name: 'Dr Weak Password',
        email: `weak-doctor.${suffix}@healpoint-test.local`,
        phone: '555-5010',
        password: '12345678901',
        clinicId: String(clinic._id),
      });
    assert.equal(weakPasswordCreate.status, 400);
    assert.match(weakPasswordCreate.body.message, /12 characters/i);

    const createForOwnedClinic = await request(app)
      .post('/api/admin/doctor-accounts')
      .set('Authorization', `Bearer ${clinicToken}`)
      .send({
        name: 'Dr Newly Created',
        email: accountEmail,
        phone: '555-5010',
        password,
        clinicId: String(clinic._id),
      });
    assert.equal(createForOwnedClinic.status, 201);
    assert.equal(createForOwnedClinic.body.data.user.role, 'doctor');
    assert.equal(createForOwnedClinic.body.data.user.isActive, true);
    assert.equal(Object.hasOwn(createForOwnedClinic.body.data.user, 'password'), false);

    const storedUser = await User.findById(createForOwnedClinic.body.data.user.id).select('+password');
    assert.ok(storedUser.password !== password);
    assert.equal(await storedUser.matchPassword(password), true);

    const candidates = await request(app)
      .get('/api/admin/doctor-candidates')
      .set('Authorization', `Bearer ${clinicToken}`);
    assert.equal(candidates.status, 200);
    assert.ok(candidates.body.data.users.some((user) => user._id === String(storedUser._id)));

    const unauthorizedCreate = await request(app)
      .post('/api/admin/doctor-accounts')
      .set('Authorization', `Bearer ${clinicToken}`)
      .send({
        name: 'Dr Outside Clinic',
        email: `outside-doctor.${suffix}@healpoint-test.local`,
        password,
        clinicId: String(otherClinic._id),
      });
    assert.equal(unauthorizedCreate.status, 403);

    const platformCreate = await request(app)
      .post('/api/admin/doctor-accounts')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({
        name: 'Dr Platform Created',
        email: `platform-doctor.${suffix}@healpoint-test.local`,
        password,
        clinicId: String(otherClinic._id),
      });
    assert.equal(platformCreate.status, 201);

    const duplicateCreate = await request(app)
      .post('/api/admin/doctor-accounts')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({
        name: 'Duplicate Doctor',
        email: accountEmail,
        password,
        clinicId: String(clinic._id),
      });
    assert.equal(duplicateCreate.status, 409);

    const patientDenied = await request(app)
      .post('/api/admin/doctor-accounts')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        name: 'Unauthorized Doctor',
        email: `patient-doctor.${suffix}@healpoint-test.local`,
        password,
        clinicId: String(clinic._id),
      });
    assert.equal(patientDenied.status, 403);
  });

  it('lets only Platform Admins create and manage Clinic Admin accounts safely', async () => {
    const endpoint = '/api/admin/clinic-admins';
    const createPayload = {
      name: 'Assigned Clinic Administrator',
      email: `assigned-admin.${suffix}@healpoint-test.local`,
      phone: '555-6020',
      password,
      clinicId: String(clinic._id),
      role: 'platform_admin',
    };

    const unauthenticated = await request(app).post(endpoint).send(createPayload);
    assert.equal(unauthenticated.status, 401);

    const clinicAdminDenied = await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${clinicToken}`)
      .send(createPayload);
    assert.equal(clinicAdminDenied.status, 403);

    const patientDenied = await request(app)
      .get(endpoint)
      .set('Authorization', `Bearer ${patientToken}`);
    assert.equal(patientDenied.status, 403);

    const missingFields = await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'Missing details' });
    assert.equal(missingFields.status, 400);

    const weakPassword = await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ ...createPayload, email: `weak-admin.${suffix}@healpoint-test.local`, password: '12345678901' });
    assert.equal(weakPassword.status, 400);
    assert.match(weakPassword.body.message, /12 characters/i);

    const invalidClinic = await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ ...createPayload, email: `invalid-clinic.${suffix}@healpoint-test.local`, clinicId: 'invalid' });
    assert.equal(invalidClinic.status, 400);

    const duplicateEmail = await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ ...createPayload, email: `clinic-admin-one.${suffix}@healpoint-test.local` });
    assert.equal(duplicateEmail.status, 409);

    otherClinic.isActive = false;
    await otherClinic.save();
    try {
      const inactiveClinic = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${platformToken}`)
        .send({ ...createPayload, email: `inactive-clinic-admin.${suffix}@healpoint-test.local`, clinicId: String(otherClinic._id) });
      assert.equal(inactiveClinic.status, 404);
    } finally {
      otherClinic.isActive = true;
      await otherClinic.save();
    }

    const created = await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${platformToken}`)
      .send(createPayload);
    assert.equal(created.status, 201);
    assert.equal(created.body.data.user.role, 'clinic_admin');
    assert.equal(created.body.data.user.isActive, true);
    assert.equal(created.body.data.user.email, createPayload.email);
    assert.equal(String(created.body.data.clinic.id), String(clinic._id));
    assert.ok(!('password' in created.body.data.user));
    assert.ok(!('password' in created.body.data));

    assignedClinicAdmin = await User.findById(created.body.data.user.id).select('+password');
    assert.equal(assignedClinicAdmin.role, 'clinic_admin');
    assert.equal(String(assignedClinicAdmin.clinic), String(clinic._id));
    assert.notEqual(assignedClinicAdmin.password, password);
    assert.equal(await assignedClinicAdmin.matchPassword(password), true);
    assignedClinicAdminToken = generateToken(assignedClinicAdmin._id);

    const activeLogin = await request(app)
      .post('/api/auth/login/')
      .send({ email: createPayload.email, password });
    assert.equal(activeLogin.status, 200);
    assert.equal(activeLogin.body.data.user.role, 'clinic_admin');
    assert.ok(!('password' in activeLogin.body.data.user));

    const resetEndpoint = `${endpoint}/${assignedClinicAdmin._id}/password`;
    const newPassword = 'NewClinicAdminPass123';
    const unauthenticatedReset = await request(app)
      .patch(resetEndpoint)
      .send({ newPassword });
    assert.equal(unauthenticatedReset.status, 401);

    const clinicAdminResetDenied = await request(app)
      .patch(resetEndpoint)
      .set('Authorization', `Bearer ${clinicToken}`)
      .send({ newPassword });
    assert.equal(clinicAdminResetDenied.status, 403);

    const patientResetDenied = await request(app)
      .patch(resetEndpoint)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ newPassword });
    assert.equal(patientResetDenied.status, 403);

    const invalidResetId = await request(app)
      .patch(`${endpoint}/invalid/password`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ newPassword });
    assert.equal(invalidResetId.status, 400);

    const nonClinicAdminReset = await request(app)
      .patch(`${endpoint}/${patient._id}/password`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ newPassword });
    assert.equal(nonClinicAdminReset.status, 404);

    const weakPasswordReset = await request(app)
      .patch(resetEndpoint)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ newPassword: '12345678901' });
    assert.equal(weakPasswordReset.status, 400);
    assert.match(weakPasswordReset.body.message, /12 characters/i);

    const overlongUtf8PasswordReset = await request(app)
      .patch(resetEndpoint)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ newPassword: '😀'.repeat(19) });
    assert.equal(overlongUtf8PasswordReset.status, 400);
    assert.match(overlongUtf8PasswordReset.body.message, /72 UTF-8 bytes/i);

    const clinicAdminBeforeReset = {
      email: assignedClinicAdmin.email,
      role: assignedClinicAdmin.role,
      clinic: String(assignedClinicAdmin.clinic),
      isActive: assignedClinicAdmin.isActive,
      tokenVersion: assignedClinicAdmin.tokenVersion,
    };
    const reset = await request(app)
      .patch(resetEndpoint)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({
        newPassword,
        email: 'changed@example.com',
        role: 'platform_admin',
        clinic: String(otherClinic._id),
        isActive: false,
      });
    assert.equal(reset.status, 200);
    assert.equal(JSON.stringify(reset.body).includes(newPassword), false);
    assert.equal(JSON.stringify(reset.body).toLowerCase().includes('passwordhash'), false);

    const savedClinicAdmin = await User.findById(assignedClinicAdmin._id).select('+password');
    assert.equal(savedClinicAdmin.email, clinicAdminBeforeReset.email);
    assert.equal(savedClinicAdmin.role, clinicAdminBeforeReset.role);
    assert.equal(String(savedClinicAdmin.clinic), clinicAdminBeforeReset.clinic);
    assert.equal(savedClinicAdmin.isActive, clinicAdminBeforeReset.isActive);
    assert.equal(savedClinicAdmin.tokenVersion, clinicAdminBeforeReset.tokenVersion + 1);
    assert.notEqual(savedClinicAdmin.password, newPassword);
    assert.equal(await savedClinicAdmin.matchPassword(password), false);
    assert.equal(await savedClinicAdmin.matchPassword(newPassword), true);

    const revokedClinicAdminSessionAfterReset = await request(app)
      .get('/api/auth/me/')
      .set('Authorization', `Bearer ${assignedClinicAdminToken}`);
    assert.equal(revokedClinicAdminSessionAfterReset.status, 401);

    const oldPasswordLogin = await request(app)
      .post('/api/auth/login/')
      .send({ email: createPayload.email, password });
    assert.equal(oldPasswordLogin.status, 401);

    const newPasswordLogin = await request(app)
      .post('/api/auth/login/')
      .send({ email: createPayload.email, password: newPassword });
    assert.equal(newPasswordLogin.status, 200);
    assert.ok(!('password' in newPasswordLogin.body.data.user));
    assignedClinicAdmin = savedClinicAdmin;
    assignedClinicAdminToken = generateToken(assignedClinicAdmin._id, assignedClinicAdmin.tokenVersion);

    const duplicate = await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${platformToken}`)
      .send(createPayload);
    assert.equal(duplicate.status, 409);

    const listed = await request(app)
      .get(endpoint)
      .set('Authorization', `Bearer ${platformToken}`)
      .query({ search: createPayload.email });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.pagination.total, 1);
    assert.equal(String(listed.body.data.clinicAdmins[0]._id), String(assignedClinicAdmin._id));
    assert.equal(String(listed.body.data.clinicAdmins[0].clinic.id), String(clinic._id));
    assert.ok(!('password' in listed.body.data.clinicAdmins[0]));

    const deactivate = await request(app)
      .patch(`${endpoint}/${assignedClinicAdmin._id}/status`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ isActive: false });
    assert.equal(deactivate.status, 200);
    assert.equal(deactivate.body.data.user.isActive, false);
    assert.ok(!('password' in deactivate.body.data.user));
    const revokedClinicAdminSession = await request(app)
      .get('/api/auth/me/')
      .set('Authorization', `Bearer ${assignedClinicAdminToken}`);
    assert.equal(revokedClinicAdminSession.status, 401);
    assert.ok((await User.findById(assignedClinicAdmin._id)).tokenVersion > 0);

    const inactiveLogin = await request(app)
      .post('/api/auth/login/')
      .send({ email: createPayload.email, password: newPassword });
    assert.equal(inactiveLogin.status, 403);

    const reactivate = await request(app)
      .patch(`${endpoint}/${assignedClinicAdmin._id}/status`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ isActive: true });
    assert.equal(reactivate.status, 200);
    assert.equal(reactivate.body.data.user.isActive, true);
    assignedClinicAdmin = await User.findById(assignedClinicAdmin._id);
    assignedClinicAdminToken = generateToken(assignedClinicAdmin._id, assignedClinicAdmin.tokenVersion);
    patientToken = generateToken(patient._id, (await User.findById(patient._id)).tokenVersion);

    const clinicAdminCannotManageAccounts = await request(app)
      .get(endpoint)
      .set('Authorization', `Bearer ${clinicToken}`);
    assert.equal(clinicAdminCannotManageAccounts.status, 403);
    const clinicAdminCannotToggleClinicAdmin = await request(app)
      .patch(`${endpoint}/${assignedClinicAdmin._id}/status`)
      .set('Authorization', `Bearer ${clinicToken}`)
      .send({ isActive: false });
    assert.equal(clinicAdminCannotToggleClinicAdmin.status, 403);
  });

  it('provides standard specialties without inserting duplicates on repeated requests', async () => {
    const first = await request(app)
      .get('/api/admin/specialties')
      .set('Authorization', `Bearer ${platformToken}`);
    const second = await request(app)
      .get('/api/admin/specialties')
      .set('Authorization', `Bearer ${clinicToken}`);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    for (const name of [
      'General Physician',
      'Cardiologist',
      'Dermatologist',
      'Pediatrician',
      'Gynecologist',
      'Orthopedic',
      'Dentist',
    ]) {
      assert.ok(first.body.data.specialties.some((specialty) => specialty.name.toLowerCase() === name.toLowerCase()));
      const count = await Specialty.countDocuments({ name: new RegExp(`^${name}$`, 'i') });
      assert.ok(count >= 1);
    }

    const duplicateSpecialty = await request(app)
      .post('/api/admin/specialties')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: 'general physician' });
    assert.equal(duplicateSpecialty.status, 409);
  });

  it('lets only Platform Admins change patient and doctor account status', async () => {
    const deactivate = await request(app)
      .patch(`/api/admin/users/${patient._id}/status`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ isActive: false });
    assert.equal(deactivate.status, 200);
    assert.equal(deactivate.body.data.user.isActive, false);
    assert.ok(!('password' in deactivate.body.data.user));

    const lockedOut = await request(app)
      .get('/api/auth/me/')
      .set('Authorization', `Bearer ${patientToken}`);
    assert.equal(lockedOut.status, 401);
    assert.ok((await User.findById(patient._id)).tokenVersion > 0);

    const clinicAdminDenied = await request(app)
      .patch(`/api/admin/users/${patient._id}/status`)
      .set('Authorization', `Bearer ${clinicToken}`)
      .send({ isActive: false });
    assert.equal(clinicAdminDenied.status, 403);

    const reactivate = await request(app)
      .patch(`/api/admin/users/${patient._id}/status`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ isActive: true });
    assert.equal(reactivate.status, 200);
    assert.equal(reactivate.body.data.user.isActive, true);
    patientToken = generateToken(patient._id, (await User.findById(patient._id)).tokenVersion);

    const deactivateDoctor = await request(app)
      .patch(`/api/admin/users/${doctorUser._id}/status`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ isActive: false });
    assert.equal(deactivateDoctor.status, 200);
    const revokedDoctorSession = await request(app)
      .get('/api/auth/me/')
      .set('Authorization', `Bearer ${doctorToken}`);
    assert.equal(revokedDoctorSession.status, 401);

    const doctorDirectory = await request(app)
      .get('/api/admin/doctors')
      .set('Authorization', `Bearer ${platformToken}`)
      .query({ status: 'inactive' });
    assert.equal(doctorDirectory.status, 200);
    assert.ok(doctorDirectory.body.data.doctors.some((item) => String(item.user._id) === String(doctorUser._id)));

    const reactivateDoctor = await request(app)
      .patch(`/api/admin/users/${doctorUser._id}/status`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ isActive: true });
    assert.equal(reactivateDoctor.status, 200);
    doctorToken = generateToken(doctorUser._id, (await User.findById(doctorUser._id)).tokenVersion);
  });

  it('limits clinic admins to owned clinics and associated doctors', async () => {
    const clinics = await request(app)
      .get('/api/admin/clinics')
      .set('Authorization', `Bearer ${clinicToken}`);
    assert.equal(clinics.status, 200);
    assert.ok(clinics.body.data.clinics.some((item) => item.id === String(clinic._id)));
    assert.ok(!clinics.body.data.clinics.some((item) => item.id === String(otherClinic._id)));
    const searchOtherClinic = await request(app)
      .get('/api/admin/clinics')
      .set('Authorization', `Bearer ${clinicToken}`)
      .query({ search: otherClinic.name });
    assert.equal(searchOtherClinic.body.pagination.total, 0);

    const doctors = await request(app)
      .get('/api/admin/doctors')
      .set('Authorization', `Bearer ${clinicToken}`);
    assert.equal(doctors.status, 200);
    assert.ok(doctors.body.data.doctors.some((item) => String(item._id) === String(doctor._id)));
    assert.ok(!doctors.body.data.doctors.some((item) => String(item._id) === String(otherDoctor._id)));
    assert.ok(doctors.body.data.doctors
      .find((item) => String(item._id) === String(doctor._id))
      .clinicAssociations.every((association) => String(association.clinic._id) === String(clinic._id)));

    const candidates = await request(app)
      .get('/api/admin/doctor-candidates')
      .set('Authorization', `Bearer ${clinicToken}`);
    assert.equal(candidates.status, 200);
    assert.ok(!candidates.body.data.users.some((user) => String(user._id) === String(otherDoctorUser._id)));

    const forbiddenCandidates = await request(app)
      .get('/api/admin/doctor-candidates')
      .set('Authorization', `Bearer ${patientToken}`);
    assert.equal(forbiddenCandidates.status, 403);
  });

  it('scopes an assigned Clinic Admin to its clinic across admin and management APIs', async () => {
    assert.ok(assignedClinicAdminToken);

    const clinics = await request(app)
      .get('/api/admin/clinics')
      .set('Authorization', `Bearer ${assignedClinicAdminToken}`);
    assert.equal(clinics.status, 200);
    assert.deepEqual(clinics.body.data.clinics.map((item) => String(item.id)), [String(clinic._id)]);

    const doctors = await request(app)
      .get('/api/admin/doctors')
      .set('Authorization', `Bearer ${assignedClinicAdminToken}`);
    assert.equal(doctors.status, 200);
    assert.deepEqual(doctors.body.data.doctors.map((item) => String(item._id)), [String(doctor._id)]);

    const patients = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${assignedClinicAdminToken}`);
    assert.equal(patients.status, 200);
    assert.deepEqual(patients.body.data.users.map((item) => String(item._id)), [String(patient._id)]);

    const appointments = await request(app)
      .get('/api/admin/appointments')
      .set('Authorization', `Bearer ${assignedClinicAdminToken}`);
    assert.equal(appointments.status, 200);
    assert.deepEqual(
      appointments.body.data.appointments.map((item) => String(item._id)).sort(),
      [String(appointment._id), String(legacyAppointment._id)].sort()
    );

    const stats = await request(app)
      .get('/api/admin/dashboard/stats')
      .set('Authorization', `Bearer ${assignedClinicAdminToken}`);
    assert.equal(stats.status, 200);
    assert.equal(stats.body.data.clinics.total, 1);

    const updateAssignedClinic = await request(app)
      .put(`/api/clinics/${clinic._id}`)
      .set('Authorization', `Bearer ${assignedClinicAdminToken}`)
      .send({ description: 'Updated by assigned admin' });
    assert.equal(updateAssignedClinic.status, 200);

    const updateOutsideClinic = await request(app)
      .put(`/api/clinics/${otherClinic._id}`)
      .set('Authorization', `Bearer ${assignedClinicAdminToken}`)
      .send({ description: 'Unauthorized update' });
    assert.equal(updateOutsideClinic.status, 403);

    const assignDoctorOutsideClinic = await request(app)
      .put(`/api/doctors/${doctor._id}`)
      .set('Authorization', `Bearer ${assignedClinicAdminToken}`)
      .send({ clinicId: String(otherClinic._id) });
    assert.equal(assignDoctorOutsideClinic.status, 403);

    const createDoctorOutsideClinic = await request(app)
      .post('/api/admin/doctor-accounts')
      .set('Authorization', `Bearer ${assignedClinicAdminToken}`)
      .send({
        name: 'Outside Assignment Doctor',
        email: `outside-assignment.${suffix}@healpoint-test.local`,
        password,
        clinicId: String(otherClinic._id),
      });
    assert.equal(createDoctorOutsideClinic.status, 403);
  });

  it('requires an active doctor association in the assigned clinic for Clinic Admin profile updates', async () => {
    assert.ok(assignedClinicAdminToken);
    const originalDoctorBio = doctor.bio;
    const originalOtherDoctorBio = otherDoctor.bio;

    try {
      const unrelatedDoctorUpdate = await request(app)
        .put(`/api/doctors/${otherDoctor._id}`)
        .set('Authorization', `Bearer ${assignedClinicAdminToken}`)
        .send({
          clinicId: String(clinic._id),
          bio: 'Unauthorized cross-clinic profile update',
        });
      assert.equal(unrelatedDoctorUpdate.status, 403);
      const unchangedOtherDoctor = await DoctorProfile.findById(otherDoctor._id);
      assert.equal(unchangedOtherDoctor.bio, originalOtherDoctorBio);

      clinicDoctor.isActive = false;
      await clinicDoctor.save();
      const inactiveAssociationUpdate = await request(app)
        .put(`/api/doctors/${doctor._id}`)
        .set('Authorization', `Bearer ${assignedClinicAdminToken}`)
        .send({
          clinicId: String(clinic._id),
          bio: 'Inactive association should not authorize',
        });
      assert.equal(inactiveAssociationUpdate.status, 403);

      clinicDoctor.isActive = true;
      await clinicDoctor.save();
      const sharedDoctorUpdate = await request(app)
        .put(`/api/doctors/${doctor._id}`)
        .set('Authorization', `Bearer ${assignedClinicAdminToken}`)
        .send({
          clinicId: String(clinic._id),
          bio: 'Authorized update for shared doctor',
          weeklySchedule: [],
        });
      assert.equal(sharedDoctorUpdate.status, 200);
      assert.equal(sharedDoctorUpdate.body.data.doctor.bio, 'Authorized update for shared doctor');
      assert.equal(
        await ClinicDoctor.countDocuments({
          doctor: doctor._id,
          clinic: otherClinic._id,
          isActive: true,
        }),
        1
      );
    } finally {
      clinicDoctor.isActive = true;
      await clinicDoctor.save();
      await DoctorProfile.updateOne({ _id: doctor._id }, { $set: { bio: originalDoctorBio } });
      await DoctorProfile.updateOne({ _id: otherDoctor._id }, { $set: { bio: originalOtherDoctorBio } });
    }
  });

  it('limits clinic patients and appointments to the clinic doctor association', async () => {
    const patients = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${clinicToken}`);
    assert.equal(patients.status, 200);
    assert.ok(patients.body.data.users.some((user) => String(user._id) === String(patient._id)));
    assert.ok(!patients.body.data.users.some((user) => String(user._id) === String(otherPatient._id)));
    assert.ok(patients.body.data.users.every((user) => user.role === 'patient' && !('password' in user)));

    const appointments = await request(app)
      .get('/api/admin/appointments')
      .set('Authorization', `Bearer ${clinicToken}`);
    assert.equal(appointments.status, 200);
    assert.deepEqual(
      appointments.body.data.appointments.map((item) => String(item._id)).sort(),
      [String(appointment._id), String(legacyAppointment._id)].sort()
    );

    const outOfScopeFilter = await request(app)
      .get('/api/admin/appointments')
      .set('Authorization', `Bearer ${clinicToken}`)
      .query({ doctorId: String(otherDoctor._id) });
    assert.equal(outOfScopeFilter.status, 200);
    assert.equal(outOfScopeFilter.body.pagination.total, 0);

    const stats = await request(app)
      .get('/api/admin/dashboard/stats')
      .set('Authorization', `Bearer ${clinicToken}`);
    assert.equal(stats.status, 200);
    assert.equal(stats.body.data.clinics.total, 1);
    assert.equal(stats.body.data.doctors.total, 1);
    assert.equal(stats.body.data.patients.total, 1);
    assert.equal(stats.body.data.appointments.total, 2);
  });

  it('scopes clinic data by owned clinic even for inactive or shared doctor assignments', async () => {
    clinicDoctor.isActive = false;
    await clinicDoctor.save();
    try {
      const doctors = await request(app)
        .get('/api/admin/doctors')
        .set('Authorization', `Bearer ${clinicToken}`);
      assert.ok(doctors.body.data.doctors.some((item) => String(item._id) === String(doctor._id)));

      const patients = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${clinicToken}`);
      assert.deepEqual(patients.body.data.users.map((user) => String(user._id)), [String(patient._id)]);

      const appointments = await request(app)
        .get('/api/admin/appointments')
        .set('Authorization', `Bearer ${clinicToken}`);
      assert.deepEqual(
        appointments.body.data.appointments.map((item) => String(item._id)).sort(),
        [String(appointment._id), String(legacyAppointment._id)].sort()
      );
    } finally {
      clinicDoctor.isActive = true;
      await clinicDoctor.save();
    }
  });

  it('allows platform admins to list cross-clinic users and filter appointments', async () => {
    const clinics = await request(app)
      .get('/api/admin/clinics')
      .set('Authorization', `Bearer ${platformToken}`)
      .query({ search: otherClinic.name });
    assert.equal(clinics.body.pagination.total, 1);
    assert.equal(clinics.body.data.clinics[0].id, String(otherClinic._id));

    const users = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${platformToken}`)
      .query({ search: `clinic-patient-two.${suffix}` });
    assert.equal(users.status, 200);
    assert.equal(users.body.pagination.total, 1);
    assert.equal(String(users.body.data.users[0]._id), String(otherPatient._id));

    const appointments = await request(app)
      .get('/api/admin/appointments')
      .set('Authorization', `Bearer ${platformToken}`)
      .query({ status: 'confirmed', patientId: String(otherPatient._id) });
    assert.equal(appointments.status, 200);
    assert.deepEqual(
      appointments.body.data.appointments.map((item) => String(item._id)),
      [String(sharedAppointment._id), String(otherAppointment._id)]
    );

    const invalidFilter = await request(app)
      .get('/api/admin/appointments')
      .set('Authorization', `Bearer ${platformToken}`)
      .query({ status: 'anything' });
    assert.equal(invalidFilter.status, 400);
  });

  it('allows only scoped admins to cancel confirmed appointments', async () => {
    const outsideScope = await request(app)
      .patch(`/api/admin/appointments/${otherAppointment._id}/status`)
      .set('Authorization', `Bearer ${clinicToken}`)
      .send({ status: 'cancelled' });
    assert.equal(outsideScope.status, 404);

    const invalidTransition = await request(app)
      .patch(`/api/admin/appointments/${appointment._id}/status`)
      .set('Authorization', `Bearer ${clinicToken}`)
      .send({ status: 'completed' });
    assert.equal(invalidTransition.status, 400);

    const cancelled = await request(app)
      .patch(`/api/admin/appointments/${appointment._id}/status`)
      .set('Authorization', `Bearer ${clinicToken}`)
      .send({ status: 'cancelled' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.appointment.status, 'cancelled');
    assert.equal(cancelled.body.data.appointment.statusHistory.at(-1).to, 'cancelled');
    assert.ok(await Notification.exists({
      recipient: patient._id,
      appointment: appointment._id,
      type: 'cancellation',
    }));

    const repeated = await request(app)
      .patch(`/api/admin/appointments/${appointment._id}/status`)
      .set('Authorization', `Bearer ${clinicToken}`)
      .send({ status: 'cancelled' });
    assert.equal(repeated.status, 409);
  });
});
