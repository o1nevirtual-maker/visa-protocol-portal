const mongoose = require('mongoose');

/**
 * Connects to MongoDB using the URI provided in the environment variables.
 */
const connectDB = async () => {
    try {
        // 1. Retrieve URI from environment variables
        const uri = process.env.MONGO_URI;
        if (!uri) {
            throw new Error("FATAL ERROR: MONGO_URI is not set in the .env file.");
        }

        console.log("\n🔗 Attempting to connect to MongoDB...");

        // 2. Establish Connection using mongoose.connect
        const connection = await mongoose.connect(uri, {
            // These options are best practice for modern Node/Mongoose setups
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        console.log("✅ MongoDB Connection Successful!");
        return connection; // Return the connection object
    } catch (error) {
        console.error("\n❌ FATAL ERROR connecting to MongoDB:", error.message);
        // Exit process if DB fails, as no other module can run without it.
        process.exit(1); 
    }
};

module.exports = connectDB;
