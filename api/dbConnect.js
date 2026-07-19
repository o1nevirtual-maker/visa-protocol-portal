let cachedDb = null;

const connectDB = async () => {
  if (cachedDb) return cachedDb;

  try {
    const mongoose = require('mongoose');
    const uri = process.env.MONGO_URI;

    if (!uri) {
      console.warn("MONGO_URI not set. Running in mock mode.");
      return null;
    }

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      bufferCommands: false
    });

    cachedDb = mongoose.connection;
    console.log("MongoDB connected!");
    return cachedDb;
  } catch (error) {
    console.error("MongoDB failed:", error.message);
    console.log("Continuing in mock mode.");
    return null;
  }
};

module.exports = connectDB;
