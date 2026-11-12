const PLACEHOLDER_JWT_SECRET = 'replace_with_a_long_random_secret';

const validateEnvironment = (environment = process.env) => {
  if (environment.NODE_ENV !== 'production') return;

  if (!environment.MONGODB_URI) {
    throw new Error('MONGODB_URI must be configured in production');
  }
  if (!environment.CLIENT_URL) {
    throw new Error('CLIENT_URL must be configured in production');
  }
  if (
    typeof environment.JWT_SECRET !== 'string' ||
    environment.JWT_SECRET.length < 32 ||
    environment.JWT_SECRET === PLACEHOLDER_JWT_SECRET
  ) {
    throw new Error('A strong JWT_SECRET must be configured in production');
  }
};

export default validateEnvironment;
