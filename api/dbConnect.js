const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const uri = process.env.MONGO_URI;
        if (!uri) {
            console.warn("MONGO_URI not set. Running without database.");
            return false;
        }

        console.log("Connecting to MongoDB Atlas...");

        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000
        });

        console.log("MongoDB Connected Successfully!");
        return true;
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        console.log("Running without database in mock mode.");
        return false;
    }
};

module.exports = connectDB;
