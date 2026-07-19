const express = require('express');
const cors = require('cors');
const { processHandler } = require('./process_logic');
const connectDB = require('./dbConnect');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// Mount all API routes
app.use('/api', processHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

// Connect to DB but don't block startup
connectDB().then(connected => {
  if (connected) {
    console.log("Database connected. API ready.");
  } else {
    console.log("No database connection. API running in mock mode.");
  }
});

// Export for Vercel
module.exports = app;
