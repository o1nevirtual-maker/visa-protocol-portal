const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;

const connectDB = async () => {
  if (cachedDb) return cachedDb;

  // Load from .env or Vercel environment
  const uri = process.env.MONGO_URI;
  
  if (!uri) {
    console.log("MONGO_URI not set — using in-memory mode");
    return null;
  }

  try {
    if (!cachedClient) {
      cachedClient = new MongoClient(uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000
      });
      await cachedClient.connect();
    }

    cachedDb = cachedClient.db('visa_portal');
    console.log("✅ MongoDB connected successfully");
    return cachedDb;
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    cachedClient = null;
    cachedDb = null;
    return null;
  }
};

module.exports = connectDB;
