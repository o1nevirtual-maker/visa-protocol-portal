const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const connectDB = require('./dbConnect'); // Make sure this connects to your MongoDB
const { processHandler } = require('./process_logic'); // Make sure this handles /api/process and /api/stats

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors({ origin: '*' }));

// Routes
app.use('/api', processHandler);

// Serve static files
const publicPath = path.join(__dirname, 'index.html');
app.get('/', (req, res) => {
  res.sendFile(publicPath);
});

// Real-time updates (every 5 seconds)
setInterval(async () => {
  try {
    const response = await fetch('/api/stats');
    const data = await response.json();
    console.log('Real-time stats:', data);
  } catch (error) {
    console.error('Real-time update error:', error);
  }
}, 5000);

// Batch override endpoint
app.post('/api/batch-override', async (req, res) => {
  const { batchId, newData } = req.body;
  try {
    // Update batch data in your database
    // Example: await updateBatch(batchId, newData)
    res.status(200).json({ message: "Batch overridden successfully!" });
  } catch (error) {
    res.status(500).json({ error: "Failed to override batch." });
  }
});

// Start server
const startServer = async () => {
  try {
    await connectDB(); // Connect to MongoDB
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
