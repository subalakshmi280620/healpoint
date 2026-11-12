const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_BYTES = 72;

const validateNewPassword = (password) => {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Password is required';
  }
  if (Array.from(password).length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return `Password must not exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes`;
  }
  return null;
};

export const validateRegisterInput = ({ name, email, password }) => {
  const errors = [];

  if (!name || !String(name).trim()) {
    errors.push('Name is required');
  }

  if (!email || !String(email).trim()) {
    errors.push('Email is required');
  } else if (!EMAIL_REGEX.test(String(email).trim().toLowerCase())) {
    errors.push('Email format is invalid');
  }

  const passwordError = validateNewPassword(password);
  if (passwordError) errors.push(passwordError);

  return errors;
};

export const validateLoginInput = ({ email, password }) => {
  const errors = [];

  if (!email || !String(email).trim()) {
    errors.push('Email is required');
  } else if (!EMAIL_REGEX.test(String(email).trim().toLowerCase())) {
    errors.push('Email format is invalid');
  }

  if (!password) {
    errors.push('Password is required');
  }

  return errors;
};
