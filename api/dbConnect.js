let cachedDb = null;

const connectDB = async () => {
  if (cachedDb) return cachedDb;

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.warn("MONGO_URI not set. Mock mode.");
    return null;
  }

  try {
    const mongoose = require('mongoose');
    
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      bufferCommands: false
    });

    cachedDb = mongoose.connection;
    console.log("MongoDB connected!");
    return cachedDb;
  } catch (error) {
    console.error("MongoDB failed:", error.message);
    return null;
  }
};

module.exports = connectDB;
