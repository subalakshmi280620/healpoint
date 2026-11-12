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

let patient;
let otherPatient;
let doctorUser;
let clinicAdmin;
let doctorProfile;
let clinic;
let clinicDoctor;
let specialty;
let patientToken;
let otherPatientToken;
let doctorToken;
let appointment;
let startAt;
let concurrentAppointmentId;

before(async () => {
  await connectTestDB();
  await Appointment.init();

  [patient, otherPatient, doctorUser, clinicAdmin, specialty] = await Promise.all([
    User.create({
      name: 'Appointment Patient',
      email: `appointment.patient.${suffix}@healpoint-test.local`,
      password,
      role: 'patient',
    }),
    User.create({
      name: 'Other Appointment Patient',
      email: `appointment.other-patient.${suffix}@healpoint-test.local`,
      password,
      role: 'patient',
    }),
    User.create({
      name: 'Appointment Doctor',
      email: `appointment.doctor.${suffix}@healpoint-test.local`,
      password,
      role: 'doctor',
    }),
    User.create({
      name: 'Appointment Clinic Admin',
      email: `appointment.clinic-admin.${suffix}@healpoint-test.local`,
      password,
      role: 'clinic_admin',
    }),
    Specialty.create({ name: `Appointment Specialty ${suffix}` }),
  ]);
  clinic = await Clinic.create({
    name: `Appointment Clinic ${suffix}`,
    email: `appointment.clinic.${suffix}@healpoint-test.local`,
    phone: '555-0000',
    address: '1 Health Way',
    city: 'Pune',
    state: 'MH',
    pincode: '411001',
    createdBy: clinicAdmin._id,
  });
  doctorProfile = await DoctorProfile.create({
    user: doctorUser._id,
    specialty: specialty._id,
    qualification: 'MD',
    experienceYears: 5,
    consultationFee: 200,
  });
  clinicDoctor = await ClinicDoctor.create({
    clinic: clinic._id,
    doctor: doctorProfile._id,
    weeklySchedule: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      startTime: '00:00',
      endTime: '23:45',
    })),
  });
  patientToken = generateToken(patient._id);
  otherPatientToken = generateToken(otherPatient._id);
  doctorToken = generateToken(doctorUser._id);

  const nextDay = new Date();
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  nextDay.setUTCHours(12, 0, 0, 0);
  startAt = nextDay.toISOString();
});

after(async () => {
  if (mongoose.connection.readyState !== 1) return;

  if (doctorProfile) {
    const appointmentIds = await Appointment.distinct('_id', { doctor: doctorProfile._id });
    await Notification.deleteMany({ appointment: { $in: appointmentIds } });
    await Appointment.deleteMany({ doctor: doctorProfile._id });
    if (clinicDoctor) await ClinicDoctor.deleteOne({ _id: clinicDoctor._id });
    await DoctorProfile.deleteOne({ _id: doctorProfile._id });
  }
  if (clinic) await Clinic.deleteOne({ _id: clinic._id });
  if (specialty) await Specialty.deleteOne({ _id: specialty._id });
  if (patient || otherPatient || doctorUser || clinicAdmin) {
    await User.deleteMany({
      _id: { $in: [patient?._id, otherPatient?._id, doctorUser?._id, clinicAdmin?._id].filter(Boolean) },
    });
  }
  await mongoose.disconnect();
});

describe('Patient appointment booking API', () => {
  it('requires authentication and patient role for doctor availability', async () => {
    const unauthorized = await request(app).get('/api/appointments/doctors').query({ startAt });
    assert.equal(unauthorized.status, 401);

    const forbidden = await request(app)
      .get('/api/appointments/doctors')
      .set('Authorization', `Bearer ${doctorToken}`)
      .query({ startAt });
    assert.equal(forbidden.status, 403);
  });

  it('validates requested date and time', async () => {
    for (const invalidStartAt of [
      'not-a-date',
      '2026-02-30T12:00:00Z',
      '2026-11-11T12:17:00Z',
      '2026-11-11T24:00:00Z',
      '2026-11-11T12:00:00+24:00',
    ]) {
      const response = await request(app)
        .get('/api/appointments/doctors')
        .set('Authorization', `Bearer ${patientToken}`)
        .query({ startAt: invalidStartAt });

      assert.equal(response.status, 400);
    }
  });

  it('lists active doctors available for a future 30-minute slot', async () => {
    const response = await request(app)
      .get('/api/appointments/doctors')
      .set('Authorization', `Bearer ${patientToken}`)
      .query({ startAt });

    assert.equal(response.status, 200);
    assert.ok(response.body.data.doctors.some((doctor) => doctor.id === String(doctorProfile._id)));
  });

  it('returns public IST slots generated from the associated clinic schedule', async () => {
    const date = new Date(new Date(startAt).getTime() + 330 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const response = await request(app)
      .get(`/api/appointments/doctors/${doctorProfile._id}/slots`)
      .query({ date });

    assert.equal(response.status, 200);
    assert.equal(response.body.data.timezone, 'Asia/Kolkata');
    assert.equal(response.body.data.associations[0].clinicDoctorId, String(clinicDoctor._id));
    assert.ok(response.body.data.associations[0].slots.length > 0);
    assert.ok(response.body.data.associations[0].slots.every((slot) => slot.durationMinutes === 30));
  });

  it('rejects bookings outside the active clinic schedule', async () => {
    const originalSchedule = clinicDoctor.weeklySchedule;
    const requestedDay = new Date(new Date(startAt).getTime() + 330 * 60 * 1000).getUTCDay();
    clinicDoctor.weeklySchedule = [{
      dayOfWeek: requestedDay,
      startTime: '09:00',
      endTime: '10:00',
    }];
    await clinicDoctor.save();
    const response = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        doctorId: doctorProfile._id,
        clinicDoctorId: clinicDoctor._id,
        startAt,
      });
    clinicDoctor.weeklySchedule = originalSchedule;
    await clinicDoctor.save();
    assert.equal(response.status, 400);
    assert.match(response.body.message, /outside the doctor’s configured schedule/);
  });

  it('books an appointment and returns its confirmed status', async () => {
    const response = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        doctorId: doctorProfile._id,
        clinicDoctorId: clinicDoctor._id,
        startAt: new Date(new Date(startAt).getTime() + 60 * 60 * 1000)
          .toISOString()
          .replace('Z', '+01:00'),
        reason: 'Annual checkup',
      });

    assert.equal(response.status, 201);
    assert.equal(response.body.data.appointment.status, 'confirmed');
    assert.equal(response.body.data.appointment.reason, 'Annual checkup');
    assert.equal(response.body.data.appointment.startAt, startAt);
    assert.equal(response.body.data.appointment.consultationFeeInr, 200);
    assert.equal(response.body.data.appointment.durationMinutes, 30);
    assert.equal(response.body.data.appointment.statusHistory.length, 1);
    assert.equal(response.body.data.appointment.statusHistory[0].to, 'confirmed');
    appointment = response.body.data.appointment;

    const notifications = await Notification.find({
      recipient: patient._id,
      appointment: appointment._id,
    });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].type, 'confirmation');

    const inbox = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${patientToken}`);
    assert.equal(inbox.status, 200);
    assert.equal(inbox.body.data.unreadCount, 1);
    const forbiddenRead = await request(app)
      .patch(`/api/notifications/${notifications[0]._id}/read`)
      .set('Authorization', `Bearer ${otherPatientToken}`);
    assert.equal(forbiddenRead.status, 404);
    const read = await request(app)
      .patch(`/api/notifications/${notifications[0]._id}/read`)
      .set('Authorization', `Bearer ${patientToken}`);
    assert.equal(read.status, 200);
    const updatedInbox = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${patientToken}`);
    assert.equal(updatedInbox.body.data.unreadCount, 0);
  });

  it('removes booked doctors from availability and rejects double booking', async () => {
    const booking = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ doctorId: doctorProfile._id, clinicDoctorId: clinicDoctor._id, startAt });
    const available = await request(app)
      .get('/api/appointments/doctors')
      .set('Authorization', `Bearer ${patientToken}`)
      .query({ startAt });
    assert.equal(booking.status, 409);
    assert.ok(!available.body.data.doctors.some((doctor) => doctor.id === String(doctorProfile._id)));
  });

  it('prevents overlapping slots even when another schedule window starts mid-visit', async () => {
    const originalSchedule = clinicDoctor.weeklySchedule;
    const overlappingStartAt = new Date(new Date(startAt).getTime() + 15 * 60 * 1000);
    const localParts = new Date(overlappingStartAt.getTime() + 330 * 60 * 1000);
    const localMinute = localParts.getUTCHours() * 60 + localParts.getUTCMinutes();
    const timeLabel = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    clinicDoctor.weeklySchedule = [{
      dayOfWeek: localParts.getUTCDay(),
      startTime: timeLabel(localMinute),
      endTime: timeLabel(localMinute + 60),
    }];
    await clinicDoctor.save();
    const response = await request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        doctorId: doctorProfile._id,
        clinicDoctorId: clinicDoctor._id,
        startAt: overlappingStartAt.toISOString(),
      });
    clinicDoctor.weeklySchedule = originalSchedule;
    await clinicDoctor.save();
    assert.equal(response.status, 409);
  });

  it('allows only the patient or assigned doctor to access and update their appointments', async () => {
    const otherPatientAppointments = await request(app)
      .get('/api/appointments')
      .set('Authorization', `Bearer ${otherPatientToken}`);
    assert.equal(otherPatientAppointments.status, 200);
    assert.equal(otherPatientAppointments.body.pagination.total, 0);

    const unauthorizedCancellation = await request(app)
      .patch(`/api/appointments/${appointment._id}/status`)
      .set('Authorization', `Bearer ${otherPatientToken}`)
      .send({ status: 'cancelled' });
    assert.equal(unauthorizedCancellation.status, 403);

    const patientCompletion = await request(app)
      .patch(`/api/appointments/${appointment._id}/status`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ status: 'completed' });
    assert.equal(patientCompletion.status, 403);

    const cancellation = await request(app)
      .patch(`/api/appointments/${appointment._id}/status`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ status: 'cancelled' });
    assert.equal(cancellation.status, 200);
    assert.equal(cancellation.body.data.appointment.status, 'cancelled');
    assert.equal(cancellation.body.data.appointment.statusHistory.at(-1).to, 'cancelled');
    assert.ok(await Notification.exists({
      recipient: patient._id,
      appointment: appointment._id,
      type: 'cancellation',
    }));
    const availability = await request(app)
      .get('/api/appointments/doctors')
      .set('Authorization', `Bearer ${patientToken}`)
      .query({ startAt });
    assert.ok(availability.body.data.doctors.some((doctor) => doctor.id === String(doctorProfile._id)));
  });

  it('uses the database unique index to prevent concurrent bookings', async () => {
    const concurrentStartAt = new Date(
      new Date(startAt).getTime() + 30 * 60 * 1000
    ).toISOString();
    const responses = await Promise.all([
      request(app)
      .post('/api/appointments')
      .set('Authorization', `Bearer ${patientToken}`)
        .send({ doctorId: doctorProfile._id, clinicDoctorId: clinicDoctor._id, startAt: concurrentStartAt }),
      request(app)
        .post('/api/appointments')
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ doctorId: doctorProfile._id, clinicDoctorId: clinicDoctor._id, startAt: concurrentStartAt }),
    ]);

    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [201, 409]
    );
    concurrentAppointmentId = responses.find((response) => response.status === 201)
      .body.data.appointment._id;
    const stored = await Appointment.find({
      doctor: doctorProfile._id,
      startAt: new Date(concurrentStartAt),
      status: 'confirmed',
    });
    assert.equal(stored.length, 1);
  });

  it('serializes competing appointment status changes', async () => {
    const responses = await Promise.all([
      request(app)
        .patch(`/api/appointments/${concurrentAppointmentId}/status`)
        .set('Authorization', `Bearer ${patientToken}`)
        .send({ status: 'cancelled' }),
      request(app)
        .patch(`/api/appointments/${concurrentAppointmentId}/status`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ status: 'completed' }),
    ]);

    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [200, 409]
    );
  });

  it('scopes doctor appointment lists, includes dashboard stats, and blocks inactive profiles', async () => {
    const response = await request(app)
      .get('/api/appointments?page=1&limit=100')
      .set('Authorization', `Bearer ${doctorToken}`);
    assert.equal(response.status, 200);
    assert.ok(response.body.data.appointments.some((item) => String(item.doctor?._id) === String(doctorProfile._id)));
    assert.equal(response.body.data.stats.total, response.body.pagination.total);
    assert.equal(
      Object.values(response.body.data.stats.byStatus).reduce((total, count) => total + count, 0),
      response.body.data.stats.total
    );
    assert.ok(response.body.data.stats.upcoming >= 0);

    await DoctorProfile.updateOne({ _id: doctorProfile._id }, { $set: { isActive: false } });
    try {
      const inactiveList = await request(app)
        .get('/api/appointments')
        .set('Authorization', `Bearer ${doctorToken}`);
      assert.equal(inactiveList.status, 403);

      const inactiveUpdate = await request(app)
        .patch(`/api/appointments/${appointment._id}/status`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({ status: 'completed' });
      assert.equal(inactiveUpdate.status, 403);
    } finally {
      await DoctorProfile.updateOne({ _id: doctorProfile._id }, { $set: { isActive: true } });
    }
  });

  it('rejects patient cancellation after the scheduled start time', async () => {
    const start = new Date(Date.now() - 60 * 1000);
    const pastAppointment = await Appointment.create({
      patient: patient._id,
      doctor: doctorProfile._id,
      clinic: clinic._id,
      clinicDoctor: clinicDoctor._id,
      startAt: start,
      endAt: new Date(start.getTime() + 30 * 60 * 1000),
    });

    const response = await request(app)
      .patch(`/api/appointments/${pastAppointment._id}/status`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ status: 'cancelled' });
    assert.equal(response.status, 409);
    assert.match(response.body.message, /after.*scheduled start/i);
    assert.equal((await Appointment.findById(pastAppointment._id)).status, 'confirmed');
  });
});
