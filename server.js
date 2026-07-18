const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
// NOTE: Ensure you have connectDB defined or imported elsewhere in your project structure.
// const connectDB = require('./api/dbConnect'); 
const { processHandler } = require('./api/process_logic');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// --- MIDDLEWARE SETUP ---
app.use(express.json()); // Allows parsing JSON body requests
app.use(cors({ origin: '*' })); // Security: Allows all origins for local testing

// --- ROUTING &amp;amp;amp;amp; ENDPOINTS ---
app.use('/api', processHandler); 

// Static file serving for index.html (Frontend View)
const publicPath = path.join(__dirname, 'index.html'); 
app.get('/', (req, res) => {
    res.sendFile(publicPath); 
});

// --- SERVER STARTUP FUNCTION ---
const startServer = async () => {
    console.log("=====================================================");
    console.log("✨ Starting Visa Portal Backend Initialization...");
    console.log("=================================================");

    try {
        // You MUST ensure connectDB() is defined or imported correctly here!
        await require('./api/dbConnect').connectDB(); 

        app.listen(PORT, () => {
            console.log("\n=============================");
            console.log(`✅ SERVER IS LIVE AND LISTENING on Port ${PORT}`);
            console.log("=====================================");
        });

    } catch (error) {
        console.error("\n🚨 FATAL SETUP ERROR: Could not initialize server:", error);
        process.exit(1);
    }
};

startServer();
