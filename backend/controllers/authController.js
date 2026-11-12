import User from '../models/User.js';
import generateToken from '../utils/generateToken.js';
import { validateLoginInput, validateRegisterInput } from '../utils/validateAuth.js';

export const register = async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;

    const validationErrors = validateRegisterInput({ name, email, password });
    if (validationErrors.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: validationErrors[0],
        errors: validationErrors,
      });
    }

    if (role && role !== 'patient') {
      return res.status(403).json({
        status: 'error',
        message: 'Public registration is only allowed for the patient role',
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({
        status: 'error',
        message: 'Email is already registered',
      });
    }

    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      password,
      phone: phone ? String(phone).trim() : '',
      role: 'patient',
    });

    const token = generateToken(user._id, user.tokenVersion);

    return res.status(201).json({
      status: 'success',
      message: 'Registration successful',
      data: {
        token,
        user: user.toSafeObject(),
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Registration failed',
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const validationErrors = validateLoginInput({ email, password });
    if (validationErrors.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: validationErrors[0],
        errors: validationErrors,
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid email or password',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        status: 'error',
        message: 'Account is inactive',
      });
    }

    const token = generateToken(user._id, user.tokenVersion);

    return res.status(200).json({
      status: 'success',
      message: 'Login successful',
      data: {
        token,
        user: user.toSafeObject(),
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Login failed',
    });
  }
};

export const logout = async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.user._id },
      { $inc: { tokenVersion: 1 } }
    );
    return res.status(200).json({
      status: 'success',
      message: 'Logged out successfully. All active sessions for this account have been revoked.',
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to log out',
    });
  }
};

export const getMe = async (req, res) => {
  try {
    return res.status(200).json({
      status: 'success',
      data: {
        user: req.user.toSafeObject(),
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to fetch profile',
    });
  }
};

export const updateMe = async (req, res) => {
  if (req.user.role !== 'patient') {
    return res.status(403).json({ status: 'error', message: 'Only patients can update this profile' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const allowedFields = new Set(['name', 'email', 'phone']);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) {
    return res.status(400).json({ status: 'error', message: 'Only name, email, and phone can be updated' });
  }
  if (!Object.keys(body).length) {
    return res.status(400).json({ status: 'error', message: 'Provide at least one profile field to update' });
  }
  if (body.name !== undefined && (
    typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 100
  )) {
    return res.status(400).json({ status: 'error', message: 'Name must be between 2 and 100 characters' });
  }
  if (body.email !== undefined && (
    typeof body.email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
  )) {
    return res.status(400).json({ status: 'error', message: 'Enter a valid email address' });
  }
  if (body.phone !== undefined && (
    typeof body.phone !== 'string' || body.phone.trim().length > 30
  )) {
    return res.status(400).json({ status: 'error', message: 'Phone must be at most 30 characters' });
  }

  try {
    if (body.name !== undefined) req.user.name = body.name.trim();
    if (body.email !== undefined) req.user.email = body.email.trim().toLowerCase();
    if (body.phone !== undefined) req.user.phone = body.phone.trim();
    await req.user.save();

    return res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      data: { user: req.user.toSafeObject() },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ status: 'error', message: 'Email is already registered' });
    }
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Unable to update profile',
    });
  }
};
