import connectDB from '../../config/db.js';

const isTransientConnectionError = (error) =>
  error?.errorLabelSet?.has('RetryableError') ||
  error?.hasErrorLabel?.('RetryableError') ||
  /ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR|tlsv1 alert internal error|ECONNRESET|ETIMEDOUT|ECONNREFUSED/i.test(
    `${error?.code || ''} ${error?.message || ''}`
  );

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const resolveTestDatabaseUri = (environment = process.env) => {
  const testUri = environment.MONGODB_TEST_URI;
  if (!testUri) {
    throw new Error('MONGODB_TEST_URI must point to a dedicated test database');
  }
  if (testUri === environment.MONGODB_URI) {
    throw new Error('MONGODB_TEST_URI must not match MONGODB_URI');
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(testUri).pathname).slice(1);
  } catch {
    throw new Error('MONGODB_TEST_URI must be a valid MongoDB URL');
  }
  if (!/(test|testing|ci)/i.test(databaseName)) {
    throw new Error('MONGODB_TEST_URI database name must clearly identify a test database');
  }
  return testUri;
};

const connectTestDB = async () => {
  const testUri = resolveTestDatabaseUri();
  const originalUri = process.env.MONGODB_URI;
  process.env.MONGODB_URI = testUri;
  const maxAttempts = 3;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await connectDB();
      } catch (error) {
        if (!isTransientConnectionError(error) || attempt === maxAttempts) {
          throw error;
        }
        console.warn(`Transient MongoDB test connection failure; retrying (${attempt + 1}/${maxAttempts}).`);
        await wait(1000);
      }
    }
  } finally {
    if (originalUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = originalUri;
  }

  throw new Error('MongoDB test connection attempts were exhausted.');
};

export default connectTestDB;
