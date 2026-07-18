const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const connectDB = require('./dbConnect');
const { processHandler } = require('./process_logic');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors({ origin: '*' }));

// API Routes
app.use('/api', processHandler);

// Serve static files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Batch override endpoint (kept separate since it's not part of processHandler)
app.post('/api/batch-override', async (req, res) => {
  const { batchId, newData } = req.body;
  try {
    // Placeholder: Update batch data in your database
    // Example: await updateBatch(batchId, newData)
    res.status(200).json({ message: "Batch overridden successfully!" });
  } catch (error) {
    res.status(500).json({ error: "Failed to override batch." });
  }
});

// Start server
const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
