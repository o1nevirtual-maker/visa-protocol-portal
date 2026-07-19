const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const connectDB = require('./dbConnect');
const { processHandler } = require('./api/process_logic');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000; // Updated fallback to 3000

// Load middleware before any route definitions
app.use(cors());
app.use(express.json());

// Mount API routes from process_logic.js (handles /api/stats, /api/process, /api/transactions/:txId)
app.use('/api', processHandler);

// Batch override endpoint
app.post('/api/batch-override', async (req, res) => {
  try {
    const { batchId, newData } = req.body;
    console.log(`Batch override requested: ${batchId}`, newData);
    return res.json({ message: "Batch overridden successfully!" });
  } catch (error) {
    return res.status(500).json({ error: "Failed to override batch.", message: error.message });
  }
});

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 catch-all — returns JSON, NEVER HTML
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Global error handler — ensures JSON even on crashes
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

// Start server
const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Stats: http://localhost:${PORT}/api/stats`);
      console.log(`Process: POST http://localhost:${PORT}/api/process`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
