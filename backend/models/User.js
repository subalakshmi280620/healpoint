import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const ROLES = ['patient', 'doctor', 'clinic_admin', 'platform_admin'];

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      validate: [
        {
          validator: (password) => typeof password === 'string' && Array.from(password).length >= 12,
          message: 'Password must be at least 12 characters',
        },
        {
          validator: (password) => typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= 72,
          message: 'Password must not exceed 72 UTF-8 bytes',
        },
      ],
      select: false,
    },
    role: {
      type: String,
      enum: ROLES,
      default: 'patient',
    },
    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

userSchema.index({ role: 1, clinic: 1 });

userSchema.pre('save', async function hashPassword() {
  if (!this.isModified('password')) {
    return;
  }

  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.matchPassword = async function matchPassword(enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.toSafeObject = function toSafeObject() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    phone: this.phone,
    isActive: this.isActive,
    createdAt: this.createdAt,
  };
};

const User = mongoose.model('User', userSchema);

export { ROLES };
export default User;
