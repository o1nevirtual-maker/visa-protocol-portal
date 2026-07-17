// dbConnect.js

const mongoose = require('mongoose');

/**
 * Connects to MongoDB using the URI stored in process.env.MONGO_URI
 */
const connectDB = async () => {
    if (mongoose.connection.readyState === 1) { // Check if already connected
        console.log("MongoDB Connection already established.");
        return mongoose.connection;
    }

    try {
        const uri = process.env.MONGO_URI;
        if (!uri) {
            throw new Error("MONGO_URI is not defined in environment variables.");
        }

        await mongoose.connect(uri);
        console.log("✅ MongoDB Connected Successfully for VisaPortal!");
        return mongoose.connection;

    } catch (error) {
        console.error("❌ FATAL: Could not connect to MongoDB:", error.message);
        // Throwing the error ensures that the main server process fails startup if DB is down
        process.exit(1); 
    }
};

module.exports = { connectDB };
