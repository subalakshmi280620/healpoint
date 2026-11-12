const DEFAULTS = {
  login: { max: 10, windowMs: 15 * 60 * 1000 },
  register: { max: 5, windowMs: 60 * 60 * 1000 },
};

const readPositiveInteger = (environment, name, fallback) => {
  const raw = environment[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
};

export const createRateLimiter = ({ max, windowMs, now = Date.now }) => {
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new Error('Rate limit max must be a positive integer');
  }
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new Error('Rate limit window must be a positive integer');
  }

  const clients = new Map();
  let nextCleanupAt = 0;
  return (req, res, next) => {
    const currentTime = now();
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';

    if (currentTime >= nextCleanupAt) {
      for (const [ip, entry] of clients) {
        if (entry.resetAt <= currentTime) clients.delete(ip);
      }
      nextCleanupAt = currentTime + Math.min(windowMs, 60_000);
    }

    let entry = clients.get(clientIp);
    if (!entry || entry.resetAt <= currentTime) {
      entry = { count: 0, resetAt: currentTime + windowMs };
      clients.set(clientIp, entry);
      if (clients.size > 50_000) {
        const oldestIp = clients.keys().next().value;
        if (oldestIp !== undefined) clients.delete(oldestIp);
      }
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - currentTime) / 1000));
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        status: 'error',
        message: 'Too many authentication attempts. Please try again later.',
      });
    }

    return next();
  };
};

export const createAuthRateLimiters = (environment = process.env) => ({
  login: createRateLimiter({
    max: readPositiveInteger(environment, 'AUTH_LOGIN_RATE_LIMIT_MAX', DEFAULTS.login.max),
    windowMs: readPositiveInteger(environment, 'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS', DEFAULTS.login.windowMs),
  }),
  register: createRateLimiter({
    max: readPositiveInteger(environment, 'AUTH_REGISTER_RATE_LIMIT_MAX', DEFAULTS.register.max),
    windowMs: readPositiveInteger(environment, 'AUTH_REGISTER_RATE_LIMIT_WINDOW_MS', DEFAULTS.register.windowMs),
  }),
});
