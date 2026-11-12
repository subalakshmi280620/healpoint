import mongoose from 'mongoose';

const scheduleWindowSchema = new mongoose.Schema(
  {
    dayOfWeek: {
      type: Number,
      min: 0,
      max: 6,
      required: true,
    },
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const clinicDoctorSchema = new mongoose.Schema(
  {
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      required: [true, 'Clinic reference is required'],
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DoctorProfile',
      required: [true, 'Doctor profile reference is required'],
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClinicBranch',
      default: null,
    },
    weeklySchedule: {
      type: [scheduleWindowSchema],
      default: [],
    },
    timezone: {
      type: String,
      enum: ['Asia/Kolkata'],
      default: 'Asia/Kolkata',
      immutable: true,
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

clinicDoctorSchema.index({ clinic: 1, doctor: 1 }, { unique: true });

const ClinicDoctor = mongoose.model('ClinicDoctor', clinicDoctorSchema);

export default ClinicDoctor;
