import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import createApp from '../app.js';
import validateEnvironment from '../config/validateEnvironment.js';
import { resolveTestDatabaseUri } from './helpers/connectTestDB.js';

describe('production environment validation', () => {
  it('sets baseline Helmet headers and a report-only CSP without HSTS in development', async () => {
    const app = createApp({
      environment: {
        NODE_ENV: 'development',
        CLIENT_URL: 'http://localhost:5173',
        TRUSTED_PROXY_IPS: '',
      },
    });
    const response = await request(app)
      .get('/api/health')
      .set('X-Forwarded-Proto', 'https');

    assert.equal(response.status, 200);
    assert.equal(response.headers['x-powered-by'], undefined);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(response.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.match(response.headers['content-security-policy-report-only'], /report-only|default-src/i);
    assert.equal(response.headers['content-security-policy'], undefined);
    assert.equal(response.headers['strict-transport-security'], undefined);
  });

  it('sets HSTS only for secure requests in production', async () => {
    const app = createApp({
      environment: {
        NODE_ENV: 'production',
        CLIENT_URL: 'https://healpoint.example',
        TRUSTED_PROXY_IPS: '::ffff:127.0.0.1/128',
      },
    });
    const httpResponse = await request(app)
      .get('/api/health')
      .set('X-Forwarded-Proto', 'http');
    const httpsResponse = await request(app)
      .get('/api/health')
      .set('X-Forwarded-Proto', 'https');

    assert.equal(httpResponse.headers['strict-transport-security'], undefined);
    assert.match(httpsResponse.headers['strict-transport-security'], /max-age=31536000/);
  });

  it('does not require deployment configuration in development', () => {
    assert.doesNotThrow(() => validateEnvironment({ NODE_ENV: 'development' }));
  });

  describe('test database isolation', () => {
    it('requires an explicitly named test database distinct from the application database', () => {
      assert.throws(
        () => resolveTestDatabaseUri({ MONGODB_URI: 'mongodb://localhost/healpoint' }),
        /MONGODB_TEST_URI/
      );
      assert.throws(
        () => resolveTestDatabaseUri({
          MONGODB_URI: 'mongodb://localhost/healpoint',
          MONGODB_TEST_URI: 'mongodb://localhost/healpoint',
        }),
        /must not match/
      );
      assert.throws(
        () => resolveTestDatabaseUri({
          MONGODB_TEST_URI: 'mongodb://localhost/healpoint',
        }),
        /test database/
      );
      assert.equal(
        resolveTestDatabaseUri({
          MONGODB_URI: 'mongodb://localhost/healpoint',
          MONGODB_TEST_URI: 'mongodb://localhost/healpoint_test',
        }),
        'mongodb://localhost/healpoint_test'
      );
    });
  });

  it('requires a database, allowed client origin, and strong JWT secret in production', () => {
    assert.throws(
      () => validateEnvironment({ NODE_ENV: 'production' }),
      /MONGODB_URI/
    );
    assert.throws(
      () => validateEnvironment({
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://localhost/test',
      }),
      /CLIENT_URL/
    );
    assert.throws(
      () => validateEnvironment({
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://localhost/test',
        CLIENT_URL: 'https://app.example.test',
        JWT_SECRET: 'too-short',
      }),
      /JWT_SECRET/
    );
    assert.doesNotThrow(() => validateEnvironment({
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://localhost/test',
      CLIENT_URL: 'https://app.example.test',
      JWT_SECRET: 'a'.repeat(32),
    }));
  });
});
