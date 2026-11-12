import mongoose from 'mongoose';

const STATUS_VALUES = ['confirmed', 'cancelled', 'completed'];

const appointmentStatusHistorySchema = new mongoose.Schema(
  {
    from: {
      type: String,
      enum: [...STATUS_VALUES, null],
      default: null,
    },
    to: {
      type: String,
      enum: STATUS_VALUES,
      required: true,
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const appointmentSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Patient reference is required'],
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DoctorProfile',
      required: [true, 'Doctor profile reference is required'],
    },
    clinicDoctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClinicDoctor',
      default: null,
    },
    clinic: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      default: null,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClinicBranch',
      default: null,
    },
    consultationFeeInr: {
      type: Number,
      min: 0,
      default: null,
    },
    durationMinutes: {
      type: Number,
      min: 15,
      max: 240,
      default: null,
    },
    startAt: {
      type: Date,
      required: [true, 'Appointment start time is required'],
    },
    endAt: {
      type: Date,
      required: [true, 'Appointment end time is required'],
    },
    status: {
      type: String,
      enum: ['confirmed', 'cancelled', 'completed'],
      default: 'confirmed',
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    slotKeys: {
      type: [Date],
      default: undefined,
    },
    statusHistory: {
      type: [appointmentStatusHistorySchema],
      default: [],
    },
  },
  { timestamps: true }
);

appointmentSchema.index(
  { doctor: 1, startAt: 1 },
  { unique: true, partialFilterExpression: { status: 'confirmed' } }
);
appointmentSchema.index({ patient: 1, startAt: -1 });
appointmentSchema.index({ doctor: 1, startAt: -1 });
appointmentSchema.index(
  { doctor: 1, slotKeys: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'confirmed', slotKeys: { $exists: true } },
  }
);

const Appointment = mongoose.model('Appointment', appointmentSchema);

export default Appointment;
