const mongoose = require('mongoose');

/**
 * Connects to MongoDB using the URI provided in the environment variables.
 * @returns {Promise<boolean>} True if connected successfully, false otherwise.
 */
const connectDB = async () => {
    try {
        // 1. Retrieve URI from environment variables (.env file)
        const uri = process.env.MONGO_URI;
        if (!uri) {
            console.warn("\n⚠️ WARNING: MONGO_URI is not set. Running without database.");
            return false;
        }

        console.log("\n🔗 Attempting to connect to MongoDB Atlas...");

        // 2. Establish Connection using mongoose
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 10000 // 10 second timeout
        });

        console.log("✅ MongoDB Connection Successful! Database ready.");
        return true;
    } catch (error) {
        console.error("\n❌ MongoDB connection failed:");

        if (error.name === 'MongoTimeoutError') {
             console.error("---> [NETWORK ISSUE]: Connection Timeout detected by Mongoose.");
        } else if (error.message && error.message.includes('FATAL ERROR')) {
            console.error(error.message);
        } else {
             console.error(`[GENERAL ERROR]: ${error.message}`);
        }

        // Do NOT call process.exit(1) — Vercel will crash!
        // Return false so the app can continue without DB
        console.log("⚠️ Server will continue without database access. Some features may not work.");
        return false;
    }
};

module.exports = connectDB;
