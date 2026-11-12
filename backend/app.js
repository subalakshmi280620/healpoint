import express from 'express';
import cors from 'cors';
import helmet, { strictTransportSecurity } from 'helmet';
import { isIP } from 'node:net';
import createApiRouter from './routes/index.js';
import { createAuthRateLimiters } from './middleware/authRateLimit.js';

const hstsMiddleware = strictTransportSecurity({
  maxAge: 31_536_000,
});

const parseTrustedProxyIps = (value) => {
  if (!value) return [];
  const addresses = value.split(',').map((address) => address.trim()).filter(Boolean);
  for (const address of addresses) {
    const parts = address.split('/');
    const [ip, prefix] = parts;
    const family = isIP(ip);
    const prefixLength = prefix === undefined ? null : Number(prefix);
    if (
      family === 0 ||
      parts.length > 2 ||
      (prefix !== undefined && (
        !/^\d+$/.test(prefix) ||
        !Number.isInteger(prefixLength) ||
        prefixLength < 0 ||
        prefixLength > (family === 4 ? 32 : 128)
      ))
    ) {
      throw new Error('TRUSTED_PROXY_IPS must contain only valid IP addresses or CIDR ranges');
    }
  }
  return addresses;
};

const createApp = ({ environment = process.env, authRateLimiters } = {}) => {
  const app = express();
  const CLIENT_URL = environment.CLIENT_URL ||
    (environment.NODE_ENV === 'production' ? null : 'http://localhost:5173');
  if (!CLIENT_URL) {
    throw new Error('CLIENT_URL must be configured in production');
  }

  app.disable('x-powered-by');
  const trustedProxyIps = parseTrustedProxyIps(environment.TRUSTED_PROXY_IPS);
  if (trustedProxyIps.length) app.set('trust proxy', trustedProxyIps);
  app.use(helmet({
    contentSecurityPolicy: {
      reportOnly: true,
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrcElem: ["'self'", 'https://fonts.googleapis.com'],
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'http://localhost:5000', 'https:'],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'sameorigin' },
    noSniff: true,
    hsts: false,
  }));
  app.use((req, res, next) => {
    if (environment.NODE_ENV === 'production' && req.secure) {
      return hstsMiddleware(req, res, next);
    }
    return next();
  });
  app.use(
    cors({
      origin: CLIENT_URL,
      credentials: true,
      exposedHeaders: ['Retry-After'],
    })
  );
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', createApiRouter({
    authRateLimiters: authRateLimiters || createAuthRateLimiters(environment),
  }));

  return app;
};

export default createApp;
