const mongoose = require('mongoose');

let cachedConnection = null;

const connectDB = async () => {
  // Return cached connection if already connected
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  try {
    const uri = process.env.MONGO_URI;
    if (!uri && !process.env.MONGODB_URI) {
      console.warn("No MongoDB URI found. Running in mock mode.");
      return null;
    }

    const connectionString = uri || process.env.MONGODB_URI;
    console.log("Connecting to MongoDB...");

    const connection = await mongoose.connect(connectionString, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      bufferCommands: false // Prevents buffering timeouts
    });

    cachedConnection = connection;
    console.log("MongoDB Connected!");
    return connection;
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    console.log("Continuing in mock mode without database.");
    return null;
  }
};

module.exports = { connectDB, isDBConnected: () => mongoose.connection.readyState === 1 };
