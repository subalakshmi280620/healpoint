import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import createApp from '../app.js';
import { createAuthRateLimiters } from '../middleware/authRateLimit.js';
import connectTestDB from './helpers/connectTestDB.js';
import User from '../models/User.js';
import generateToken from '../utils/generateToken.js';

dotenv.config();

const app = createApp();
const testSuffix = Date.now();
const patientEmail = `patient.${testSuffix}@healpoint-test.local`;
const password = 'SecretPassword123';

before(async () => {
  await connectTestDB();
});

after(async () => {
  if (mongoose.connection.readyState !== 1) return;

  await User.deleteMany({ email: new RegExp(`\\.${testSuffix}@healpoint-test\\.local$`, 'i') });
  await mongoose.disconnect();
});

describe('HealPoint authentication API', () => {
  let authToken;
  let registrationToken;

  it('GET /api/health returns success', async () => {
    const response = await request(app).get('/api/health');

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'success');
    assert.equal(response.body.message, 'HealPoint API is running');
  });

  it('POST /api/auth/register/ creates a patient account', async () => {
    const response = await request(app).post('/api/auth/register/').send({
      name: 'Test Patient',
      email: patientEmail,
      password,
      phone: '555-0100',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.status, 'success');
    assert.ok(response.body.data.token);
    assert.equal(response.body.data.user.email, patientEmail);
    assert.equal(response.body.data.user.role, 'patient');
    assert.equal(response.body.data.user.password, undefined);
    assert.ok(!('password' in response.body.data.user));

    authToken = response.body.data.token;
    registrationToken = response.body.data.token;
    assert.equal(jwt.decode(authToken).tokenVersion, 0);
  });

  it('POST /api/auth/register/ rejects elevated roles', async () => {
    const response = await request(app).post('/api/auth/register/').send({
      name: 'Fake Doctor',
      email: `doctor.${testSuffix}@healpoint-test.local`,
      password,
      role: 'doctor',
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.status, 'error');
  });

  it('POST /api/auth/register/ validates password length', async () => {
    const response = await request(app).post('/api/auth/register/').send({
      name: 'Short Password',
      email: `short.${testSuffix}@healpoint-test.local`,
      password: 'short',
    });

    assert.equal(response.status, 400);
    assert.match(response.body.message, /password/i);

    const elevenCharacters = await request(app).post('/api/auth/register/').send({
      name: 'Eleven Characters',
      email: `eleven.${testSuffix}@healpoint-test.local`,
      password: '12345678901',
    });
    assert.equal(elevenCharacters.status, 400);
    assert.match(elevenCharacters.body.message, /12 characters/i);

    const multibyteOverLimit = await request(app).post('/api/auth/register/').send({
      name: 'Long UTF8 Password',
      email: `long-utf8.${testSuffix}@healpoint-test.local`,
      password: `${'😀'.repeat(18)}a`,
    });
    assert.equal(multibyteOverLimit.status, 400);
    assert.match(multibyteOverLimit.body.message, /72 UTF-8 bytes/i);
  });

  it('POST /api/auth/login/ authenticates a valid user', async () => {
    const response = await request(app).post('/api/auth/login/').send({
      email: patientEmail,
      password,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'success');
    assert.ok(response.body.data.token);
    assert.equal(response.body.data.user.email, patientEmail);
    assert.ok(!('password' in response.body.data.user));

    authToken = response.body.data.token;
  });

  it('POST /api/auth/login/ rejects invalid credentials', async () => {
    const response = await request(app).post('/api/auth/login/').send({
      email: patientEmail,
      password: 'WrongPassword!',
    });

    assert.equal(response.status, 401);
    assert.equal(response.body.status, 'error');
    assert.match(response.body.message, /invalid/i);
  });

  it('GET /api/auth/me/ returns the current user with a valid token', async () => {
    const response = await request(app)
      .get('/api/auth/me/')
      .set('Authorization', `Bearer ${authToken}`);

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'success');
    assert.equal(response.body.data.user.email, patientEmail);
    assert.equal(response.body.data.user.role, 'patient');
    assert.ok(!('password' in response.body.data.user));
  });

  it('GET /api/auth/me/ rejects requests without a token', async () => {
    const response = await request(app).get('/api/auth/me/');

    assert.equal(response.status, 401);
    assert.equal(response.body.status, 'error');
  });

  it('updates only the authenticated patient profile and never accepts role changes', async () => {
    const updated = await request(app)
      .patch('/api/auth/me/')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Updated Patient', phone: '555-0199' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.user.name, 'Updated Patient');
    assert.equal(updated.body.data.user.phone, '555-0199');
    assert.equal(updated.body.data.user.role, 'patient');
    assert.ok(!('password' in updated.body.data.user));

    const roleChange = await request(app)
      .patch('/api/auth/me/')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ role: 'platform_admin' });
    assert.equal(roleChange.status, 400);

    const invalidEmail = await request(app)
      .patch('/api/auth/me/')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ email: 'not-an-email' });
    assert.equal(invalidEmail.status, 400);
  });

  it('revokes every existing session on logout and allows a newly authenticated session', async () => {
    const anotherLogin = await request(app)
      .post('/api/auth/login/')
      .send({ email: patientEmail, password });
    assert.equal(anotherLogin.status, 200);
    const logout = await request(app)
      .post('/api/auth/logout/')
      .set('Authorization', `Bearer ${authToken}`);
    assert.equal(logout.status, 200);
    assert.match(logout.body.message, /all active sessions/i);

    for (const token of [authToken, anotherLogin.body.data.token, registrationToken]) {
      const revoked = await request(app)
        .get('/api/auth/me/')
        .set('Authorization', `Bearer ${token}`);
      assert.equal(revoked.status, 401);
    }

    const nextLogin = await request(app)
      .post('/api/auth/login/')
      .send({ email: patientEmail, password });
    assert.equal(nextLogin.status, 200);
    assert.equal(jwt.decode(nextLogin.body.data.token).tokenVersion, 1);
    const validNewSession = await request(app)
      .get('/api/auth/me/')
      .set('Authorization', `Bearer ${nextLogin.body.data.token}`);
    assert.equal(validNewSession.status, 200);
  });

  it('rejects expired JWTs and preserves login for existing shorter passwords', async () => {
    const legacyUser = await User.create({
      name: 'Legacy Password User',
      email: `legacy.${testSuffix}@healpoint-test.local`,
      password: 'LegacyLongPassword7',
      role: 'patient',
    });
    const bcrypt = await import('bcryptjs');
    await User.collection.updateOne(
      { _id: legacyUser._id },
      { $set: { password: await bcrypt.default.hash('Legacy7', 12) } }
    );
    const legacyLogin = await request(app)
      .post('/api/auth/login/')
      .send({ email: legacyUser.email, password: 'Legacy7' });
    assert.equal(legacyLogin.status, 200);

    const previousExpiry = process.env.JWT_EXPIRES_IN;
    process.env.JWT_EXPIRES_IN = '1s';
    try {
      const expiringToken = generateToken(legacyUser._id, legacyUser.tokenVersion);
      assert.equal(jwt.decode(expiringToken).tokenVersion, legacyUser.tokenVersion);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const expiredResponse = await request(app)
        .get('/api/auth/me/')
        .set('Authorization', `Bearer ${expiringToken}`);
      assert.equal(expiredResponse.status, 401);
    } finally {
      if (previousExpiry === undefined) delete process.env.JWT_EXPIRES_IN;
      else process.env.JWT_EXPIRES_IN = previousExpiry;
    }
  });

  describe('new password validation', () => {
    it('enforces twelve Unicode characters and the bcrypt UTF-8 byte limit in the shared validator', async () => {
      const { validateRegisterInput } = await import('../utils/validateAuth.js');
      assert.match(
        validateRegisterInput({ name: 'Test User', email: 'test@example.com', password: '12345678901' })[0],
        /12 characters/
      );
      assert.match(
        validateRegisterInput({ name: 'Test User', email: 'test@example.com', password: `${'😀'.repeat(18)}a` })[0],
        /72 UTF-8 bytes/
      );
      assert.deepEqual(
        validateRegisterInput({ name: 'Test User', email: 'test@example.com', password: '😀'.repeat(12) }),
        []
      );
    });
  });

  it('uses a 12-hour default JWT lifetime when no override is configured', () => {
    const previousExpiry = process.env.JWT_EXPIRES_IN;
    delete process.env.JWT_EXPIRES_IN;
    try {
      const token = generateToken('507f1f77bcf86cd799439011', 3);
      const payload = jwt.decode(token);
      assert.equal(payload.tokenVersion, 3);
      assert.equal(payload.exp - payload.iat, 12 * 60 * 60);
    } finally {
      if (previousExpiry !== undefined) process.env.JWT_EXPIRES_IN = previousExpiry;
    }
  });
});

describe('authentication endpoint rate limits', () => {
  const testApp = createApp({
    environment: {
      NODE_ENV: 'test',
      CLIENT_URL: 'http://localhost:5173',
      TRUSTED_PROXY_IPS: '',
    },
    authRateLimiters: createAuthRateLimiters({
      AUTH_LOGIN_RATE_LIMIT_MAX: '2',
      AUTH_LOGIN_RATE_LIMIT_WINDOW_MS: '1000',
      AUTH_REGISTER_RATE_LIMIT_MAX: '2',
      AUTH_REGISTER_RATE_LIMIT_WINDOW_MS: '1000',
    }),
  });

  it('limits login and registration separately, returns Retry-After, resets, and leaves other routes unthrottled', async () => {
    const loginAttempt = (forwardedFor) =>
      request(testApp)
        .post('/api/auth/login/')
        .set('X-Forwarded-For', forwardedFor)
        .send({});
    const registrationAttempt = (forwardedFor) =>
      request(testApp)
        .post('/api/auth/register/')
        .set('X-Forwarded-For', forwardedFor)
        .send({});

    assert.equal((await loginAttempt('198.51.100.10')).status, 400);
    assert.equal((await loginAttempt('203.0.113.20')).status, 400);
    const loginLimited = await loginAttempt('192.0.2.30');
    assert.equal(loginLimited.status, 429);
    assert.equal(loginLimited.body.message, 'Too many authentication attempts. Please try again later.');
    assert.ok(Number(loginLimited.headers['retry-after']) >= 1);
    assert.ok(!loginLimited.body.message.includes('email'));

    assert.equal((await registrationAttempt('198.51.100.11')).status, 400);
    assert.equal((await registrationAttempt('203.0.113.21')).status, 400);
    const registrationLimited = await registrationAttempt('192.0.2.31');
    assert.equal(registrationLimited.status, 429);
    assert.equal(registrationLimited.body.message, loginLimited.body.message);
    assert.ok(Number(registrationLimited.headers['retry-after']) >= 1);

    const health = await request(testApp).get('/api/health');
    assert.equal(health.status, 200);
    const authenticatedRoute = await request(testApp).get('/api/auth/me/');
    assert.equal(authenticatedRoute.status, 401);

    await new Promise((resolve) => setTimeout(resolve, 1050));
    assert.equal((await loginAttempt('192.0.2.30')).status, 400);
    assert.equal((await registrationAttempt('192.0.2.31')).status, 400);
  });
});
