import mongoose from 'mongoose';
import geoPointSchema from './geoPointSchema.js';

const clinicBranchSchema = new mongoose.Schema(
  {
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: [true, 'Clinic reference is required'],
    },
    name: {
      type: String,
      required: [true, 'Branch name is required'],
      trim: true,
    },
    address: {
      type: String,
      required: [true, 'Branch address is required'],
      trim: true,
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
    },
    pincode: {
      type: String,
      required: [true, 'Pincode is required'],
      trim: true,
    },
    location: { type: geoPointSchema, default: undefined },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

clinicBranchSchema.index({ clinic: 1, name: 1 }, { unique: true });
clinicBranchSchema.index({ location: '2dsphere' });

const ClinicBranch = mongoose.model('ClinicBranch', clinicBranchSchema);

export default ClinicBranch;
