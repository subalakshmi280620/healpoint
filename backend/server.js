import dotenv from 'dotenv';
import createApp from './app.js';
import connectDB from './config/db.js';
import validateEnvironment from './config/validateEnvironment.js';

dotenv.config();

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    validateEnvironment();
    const app = createApp();
    await connectDB();

    app.listen(PORT, () => {
      console.log(`HealPoint API listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start HealPoint API:', error.message);
    process.exit(1);
  }
};

startServer();
