const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const connectDB = require('./dbConnect');
const { processHandler } = require('./api/process_logic');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors({ origin: '*' }));

// API Routes — MUST come before static routes
app.use('/api', processHandler);

// Batch override endpoint
app.post('/api/batch-override', async (req, res) => {
  res.status(200).json({ message: "Batch overridden successfully!" });
});

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 404 catch-all — returns JSON, never HTML
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Start server
const startServer = async () => {
  await connectDB(); // Won't crash if MongoDB is down
  app.listen(PORT, () => {
    console.log(`\n✅ Server running on http://localhost:${PORT}`);
    console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
    console.log(`💳 Process: POST http://localhost:${PORT}/api/process`);
  });
};

startServer();
