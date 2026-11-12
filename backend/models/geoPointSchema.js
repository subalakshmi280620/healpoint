import mongoose from 'mongoose';

const geoPointSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (coordinates) =>
          Array.isArray(coordinates) &&
          coordinates.length === 2 &&
          Number.isFinite(coordinates[0]) &&
          coordinates[0] >= -180 &&
          coordinates[0] <= 180 &&
          Number.isFinite(coordinates[1]) &&
          coordinates[1] >= -90 &&
          coordinates[1] <= 90,
        message: 'Location must contain valid [longitude, latitude] coordinates',
      },
    },
  },
  { _id: false }
);

export default geoPointSchema;
