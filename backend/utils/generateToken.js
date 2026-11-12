import jwt from 'jsonwebtoken';

const generateToken = (userId, tokenVersion = 0) => {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || '12h';

  if (!secret) {
    throw new Error('JWT_SECRET is not defined in environment variables');
  }

  return jwt.sign({ id: userId, tokenVersion }, secret, { expiresIn });
};

export default generateToken;
