const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI;
    if (!uri) {
      throw new Error("MONGO_URI is not set in the .env file.");
    }

    console.log("\n🔗 Attempting to connect to MongoDB...");

    const connection = await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000 // 10 second timeout
    });

    console.log("✅ MongoDB Connection Successful!");
    return connection;
  } catch (error) {
    console.error("\n❌ MongoDB connection failed:", error.message);
    console.log("⚠️  Server will start WITHOUT database. Stats/transactions will fail.");
    // DO NOT exit — let the server start so you can debug
    return null;
  }
};

module.exports = connectDB;
