import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { stdin, stdout } from 'node:process';

dotenv.config();

const readHidden = (prompt) => new Promise((resolve, reject) => {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    reject(new Error('Password input requires an interactive terminal.'));
    return;
  }

  const wasRaw = Boolean(stdin.isRaw);
  let value = '';
  let settled = false;

  const cleanup = () => {
    stdin.off('data', onData);
    stdin.off('end', onEnd);
    stdin.setRawMode(wasRaw);
    stdout.write('\n');
  };

  const finish = (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (error) reject(error);
    else resolve(value);
  };

  const onEnd = () => finish(new Error('Password input ended.'));
  const onData = (chunk) => {
    for (const character of chunk) {
      if (character === '\r' || character === '\n') {
        finish();
        return;
      }
      if (character === '\u0003' || character === '\u0004') {
        finish(new Error('Password entry cancelled.'));
        return;
      }
      if (character === '\u007f' || character === '\b') {
        value = Array.from(value).slice(0, -1).join('');
      } else if (character >= ' ') {
        value += character;
      }
    }
  };

  stdin.setEncoding('utf8');
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on('data', onData);
  stdin.once('end', onEnd);
  stdout.write(prompt);
});

try {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing');

  const parsed = new URL(uri);
  if (
    parsed.hostname !== 'healpointcluster.eqtggaj.mongodb.net' ||
    parsed.pathname.split('/')[1] !== 'healpoint'
  ) {
    throw new Error('Database verification failed. No changes made.');
  }

  await mongoose.connect(uri);

  const user = await User.findOne({
    email: 'suba@gmail.com',
    role: 'platform_admin',
  }).select('+password');

  if (!user) throw new Error('Platform admin not found. No changes made.');
  if (!user.isActive) throw new Error('Admin account is inactive. No changes made.');

  const password = await readHidden('Enter NEW password: ');
  const confirm = await readHidden('Confirm NEW password: ');

  if (password !== confirm) throw new Error('Passwords do not match.');
  if (Array.from(password).length < 12) throw new Error('Password must be at least 12 characters.');
  if (Buffer.byteLength(password, 'utf8') > 72) throw new Error('Password exceeds 72 bytes.');

  user.password = password;
  await user.save({ timestamps: false });

  console.log('SUCCESS: Existing platform admin password updated.');
} catch (error) {
  console.log('STOPPED:', error.message);
} finally {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
