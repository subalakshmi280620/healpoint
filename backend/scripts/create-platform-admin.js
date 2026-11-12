import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { validateRegisterInput } from '../utils/validateAuth.js';

dotenv.config();

const name = process.env.PLATFORM_ADMIN_NAME;
const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.PLATFORM_ADMIN_PASSWORD;
const validationErrors = validateRegisterInput({ name, email, password });

if (validationErrors.length > 0) {
  console.error(`Invalid bootstrap input: ${validationErrors.join('; ')}`);
  process.exitCode = 1;
} else if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not configured.');
  process.exitCode = 1;
} else {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
    });

    if (await User.exists({ role: 'platform_admin' })) {
      console.error('A Platform Admin already exists; refusing to create another.');
      process.exitCode = 1;
    } else if (await User.exists({ email })) {
      console.error('An account with that email already exists; refusing to create it as an admin.');
      process.exitCode = 1;
    } else {
      await User.create({
        name: name.trim(),
        email,
        password,
        role: 'platform_admin',
        isActive: true,
      });
      console.log('Initial Platform Admin account created successfully.');
    }
  } catch (error) {
    if (error?.code === 11000) {
      console.error('An account or Platform Admin already exists; no duplicate was created.');
    } else {
      console.error('Platform Admin setup failed. Check MongoDB connectivity and configuration.');
    }
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      try {
        await mongoose.disconnect();
      } catch {
        console.error('Unable to close the MongoDB connection cleanly.');
        process.exitCode = 1;
      }
    }
  }
}
