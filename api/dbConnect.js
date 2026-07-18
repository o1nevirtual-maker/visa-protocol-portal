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
            throw new Error("FATAL ERROR: MONGO_URI is not set in the .env file.");
        }

        console.log("\n🔗 Attempting to connect to MongoDB Atlas...");

        // 2. Establish Connection using mongoose's robust methods
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        console.log("✅ MongoDB Connection Successful! Database ready.");
        return true; // Success signal
    } catch (error) {
        // Comprehensive error handling based on diagnosing common failures.
        console.error("\n❌ FATAL ERROR connecting to MongoDB Atlas:");

        if (error.name === 'MongoTimeoutError') {
             console.error("---> [NETWORK ISSUE]: Connection Timeout detected by Mongoose.");
        } else if (error.message && error.message.includes('FATAL ERROR')) {
            console.error(error.message);
        } 
        else {
             console.error(`[GENERAL ERROR]: ${error.message}`);
        }

        // CRITICAL: Exit immediately on failure as the application cannot function without DB access.
        process.exit(1); 
    }
};

module.exports = connectDB;
