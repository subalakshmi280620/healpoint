import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      status: 'error',
      message: 'Not authorized, token missing',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      return res.status(500).json({
        status: 'error',
        message: 'JWT_SECRET is not configured',
      });
    }

    const decoded = jwt.verify(token, secret);
    const tokenVersion = decoded.tokenVersion === undefined ? 0 : decoded.tokenVersion;
    if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0) {
      return res.status(401).json({
        status: 'error',
        message: 'Not authorized, token invalid',
      });
    }
    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      return res.status(401).json({
        status: 'error',
        message: 'Not authorized, user unavailable',
      });
    }
    if ((user.tokenVersion || 0) !== tokenVersion) {
      return res.status(401).json({
        status: 'error',
        message: 'Not authorized, token revoked',
      });
    }

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({
      status: 'error',
      message: 'Not authorized, token invalid',
    });
  }
};
