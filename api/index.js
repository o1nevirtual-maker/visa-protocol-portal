const express = require('express');
const cors = require('cors');
const { processHandler } = require('./process_logic');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

app.use('/api', processHandler);

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(500).json({ error: "Internal Server Error", message: err.message });
});

module.exports = app;
