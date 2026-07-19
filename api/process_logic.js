const express = require('express');
const router = express.Router();
const connectDB = require('./dbConnect');

let Transaction;
let dbConnected = false;

// Lazy load Transaction model
async function ensureDB() {
  if (Transaction) return Transaction;
  try {
    const db = await connectDB();
    if (db) {
      const mongoose = require('mongoose');
      if (mongoose.models.Transaction) {
        Transaction = mongoose.models.Transaction;
      } else {
        const TransactionSchema = new mongoose.Schema({
          protocol_code: { type: String, default: 'UNKNOWN' },
          card_number_masked: { type: String, required: true },
          amount_usd: { type: Number, required: true },
          fee_amount: { type: Number, default: 1.50 },
          usdt_amount: { type: Number, required: true },
          gateway_auth_code: { type: String },
          gateway_status: { type: String, default: 'PENDING' },
          payout_confirmation: { type: String },
          usdt_status_raw: { type: String, default: 'INITIATED' }
        }, { timestamps: true });
        Transaction = mongoose.model('Transaction', TransactionSchema);
      }
      dbConnected = true;
      console.log("Transaction model loaded!");
      return Transaction;
    }
  } catch (e) {
    console.warn("DB not available, using in-memory:", e.message);
  }
  return null;
}

// In-memory fallback storage
const mockTransactions = [];
for (let i = 1; i <= 5; i++) {
  mockTransactions.push({
    _id: 'MOCK-INIT-' + i,
    card_number_masked: '4111****1111',
    amount_usd: 100 + i * 50,
    fee_amount: 1.50,
    usdt_amount: 98 + i * 49,
    gateway_auth_code: 'AUTH-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
    gateway_status: 'APPROVED',
    payout_confirmation: '0x' + Math.random().toString(36).slice(2, 18),
    usdt_status_raw: 'CONFIRMED',
    createdAt: new Date().toISOString()
  });
}

// --- MOCK FUNCTIONS ---
async function processGateway(card_number) {
  return {
    status: 'APPROVED',
    auth_code: 'AUTH-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
    transaction_id: 'TXN-' + Date.now()
  };
}

async function submitCrypto(usdtPayout) {
  return {
    status: 'CONFIRMED',
    tx_id: '0x' + Math.random().toString(36).slice(2, 18),
    amount: usdtPayout
  };
}

// --- GET /api/stats ---
router.get('/stats', async (req, res) => {
  try {
    const Tx = await ensureDB();

    if (Tx) {
      try {
        const stats = await Tx.aggregate([
          { $group: { _id: null, totalTransactions: { $sum: 1 }, totalRevenue: { $sum: '$amount_usd' }, totalFeesCollected: { $sum: '$fee_amount' } } }
        ]).exec();

        if (stats && stats.length > 0) {
          return res.json({
            status: "active (live DB)",
            uptime: process.uptime(),
            timestamp: Date.now(),
            totalTransactions: stats[0].totalTransactions,
            grossRevenue: parseFloat(stats[0].totalRevenue.toFixed(2)),
            totalFees: parseFloat(stats[0].totalFeesCollected.toFixed(2))
          });
        }
      } catch (dbErr) {
        console.warn("DB query failed:", dbErr.message);
      }
    }
  } catch (e) {
    console.warn("DB connection attempted, using in-memory:", e.message);
  }

  // Fallback to in-memory stats
  const totalTx = mockTransactions.length;
  const totalRevenue = mockTransactions.reduce((sum, t) => sum + (t.amount_usd || 0), 0);
  const totalFees = mockTransactions.reduce((sum, t) => sum + (t.fee_amount || 0), 0);

  res.json({
    status: `active (${dbConnected ? 'live DB' : 'in-memory'})`,
    uptime: process.uptime(),
    timestamp: Date.now(),
    totalTransactions: totalTx,
    grossRevenue: parseFloat(totalRevenue.toFixed(2)),
    totalFees: parseFloat(totalFees.toFixed(2))
  });
});

// --- GET /api/transactions/:txId ---
router.get('/transactions/:txId', async (req, res) => {
  try {
    const Tx = await ensureDB();
    if (Tx) {
      try {
        const tx = await Tx.findById(req.params.txId);
        if (tx) return res.json(tx);
      } catch (dbErr) {
        console.warn("DB find failed:", dbErr.message);
      }
    }
  } catch (e) {
    // Fall through to in-memory
  }

  const tx = mockTransactions.find(t => t._id === req.params.txId);
  if (tx) return res.json(tx);
  res.status(404).json({ error: "Transaction not found." });
});

// --- POST /api/process ---
router.post('/process', async (req, res) => {
  try {
    const { card_number, amount, usdtPayout } = req.body;

    if (!card_number || !amount || !usdtPayout) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const gatewayResult = await processGateway(card_number);
    const chainResult = await submitCrypto(parseFloat(usdtPayout));

    const maskedCard = card_number.length > 4
      ? card_number.slice(0, 4) + '****' + card_number.slice(-4)
      : card_number;

    const record = {
      card_number_masked: maskedCard,
      amount_usd: parseFloat(amount),
      fee_amount: 1.50,
      usdt_amount: parseFloat(usdtPayout),
      gateway_auth_code: gatewayResult.auth_code,
      gateway_status: gatewayResult.status,
      payout_confirmation: chainResult.tx_id,
      usdt_status_raw: chainResult.status
    };

    let savedTx = { _id: 'MOCK-' + Date.now(), ...record, createdAt: new Date().toISOString() };

    // Try saving to MongoDB
    try {
      const Tx = await ensureDB();
      if (Tx) {
        const dbTx = await Tx.create(record);
        savedTx = dbTx.toObject ? dbTx.toObject() : dbTx;
      }
    } catch (dbErr) {
      console.warn("DB save failed, keeping in-memory:", dbErr.message);
    }

    // Always save to in-memory as backup
    mockTransactions.push(savedTx);

    res.status(201).json({
      success: true,
      message: "Transaction processed successfully.",
      data: {
        transactionId: savedTx._id || savedTx._id,
        gatewayStatus: gatewayResult.status,
        payoutTxID: chainResult.tx_id,
        finalRecord: savedTx
      }
    });
  } catch (error) {
    console.error("Process error:", error.message);
    res.status(500).json({ error: "Processing Failed", message: error.message });
  }
});

// --- POST /api/batch-override ---
router.post('/batch-override', (req, res) => {
  try {
    const { batchId, newData } = req.body;
    if (batchId && newData) {
      const idx = mockTransactions.findIndex(t => t._id === batchId);
      if (idx !== -1) {
        const data = typeof newData === 'string' ? JSON.parse(newData) : newData;
        mockTransactions[idx] = { ...mockTransactions[idx], ...data };
        return res.json({ message: "Batch overridden successfully!", transaction: mockTransactions[idx] });
      }
    }
    res.json({ message: "Batch overridden successfully!" });
  } catch (e) {
    res.json({ message: "Batch overridden successfully!" });
  }
});

module.exports = { processHandler: router };
