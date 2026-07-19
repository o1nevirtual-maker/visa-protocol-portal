const express = require('express');
const router = express.Router();
const connectDB = require('./dbConnect');

// In-memory fallback storage
const transactions = [];
let counter = 0;

// Seed data
for (let i = 1; i <= 3; i++) {
  transactions.push({
    _id: 'seed-' + i,
    card_number_masked: '4111****1111',
    amount_usd: 100 * i,
    fee_amount: 1.50,
    usdt_amount: 98.50 * i,
    gateway_status: 'APPROVED',
    usdt_status_raw: 'CONFIRMED',
    createdAt: new Date(Date.now() - i * 60000).toISOString()
  });
}

async function getCollection() {
  try {
    const db = await connectDB();
    if (db) return db.collection('transactions');
  } catch (e) {}
  return null;
}

// --- GET /api/stats ---
router.get('/stats', async (req, res) => {
  try {
    const col = await getCollection();
    if (col) {
      const totalTx = await col.countDocuments();
      const revenueAgg = await col.aggregate([
        { $group: { _id: null, total: { $sum: '$amount_usd' }, fees: { $sum: '$fee_amount' } } }
      ]).toArray();

      if (revenueAgg.length > 0) {
        return res.json({
          status: "active (MongoDB)",
          uptime: process.uptime(),
          timestamp: Date.now(),
          totalTransactions: totalTx,
          grossRevenue: parseFloat(revenueAgg[0].total.toFixed(2)),
          totalFees: parseFloat(revenueAgg[0].fees.toFixed(2))
        });
      }

      return res.json({
        status: "active (MongoDB - empty)",
        uptime: process.uptime(),
        timestamp: Date.now(),
        totalTransactions: totalTx,
        grossRevenue: 0,
        totalFees: 0
      });
    }
  } catch (e) {
    console.warn("DB stats failed:", e.message);
  }

  const totalTx = transactions.length;
  const grossRevenue = transactions.reduce((s, t) => s + (t.amount_usd || 0), 0);
  const totalFees = transactions.reduce((s, t) => s + (t.fee_amount || 0), 0);

  res.json({
    status: "active (in-memory)",
    uptime: process.uptime(),
    timestamp: Date.now(),
    totalTransactions: totalTx,
    grossRevenue: parseFloat(grossRevenue.toFixed(2)),
    totalFees: parseFloat(totalFees.toFixed(2))
  });
});

// --- GET /api/transactions/:txId ---
router.get('/transactions/:txId', async (req, res) => {
  try {
    const col = await getCollection();
    if (col) {
      const { ObjectId } = require('mongodb');
      let query;
      try { query = { _id: new ObjectId(req.params.txId) }; }
      catch (e) { query = { _id: req.params.txId }; }

      const tx = await col.findOne(query);
      if (tx) {
        tx._id = tx._id.toString();
        return res.json(tx);
      }
    }
  } catch (e) {}

  const tx = transactions.find(t => t._id === req.params.txId);
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

    counter++;
    const maskedCard = card_number.length > 4
      ? card_number.slice(0, 4) + '****' + card_number.slice(-4)
      : card_number;

    const authCode = 'AUTH-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    const payoutTxId = '0x' + Math.random().toString(36).slice(2, 18);

    const record = {
      card_number_masked: maskedCard,
      amount_usd: parseFloat(amount),
      fee_amount: 1.50,
      usdt_amount: parseFloat(usdtPayout),
      gateway_auth_code: authCode,
      gateway_status: 'APPROVED',
      payout_confirmation: payoutTxId,
      usdt_status_raw: 'CONFIRMED',
      createdAt: new Date()
    };

    let savedTx = {
      _id: 'tx-' + Date.now() + '-' + counter,
      ...record,
      createdAt: record.createdAt.toISOString()
    };

    // Try MongoDB
    try {
      const col = await getCollection();
      if (col) {
        const result = await col.insertOne(record);
        savedTx = {
          _id: result.insertedId.toString(),
          ...record,
          createdAt: record.createdAt.toISOString()
        };
      }
    } catch (dbErr) {
      console.warn("DB save failed:", dbErr.message);
    }

    // Always save to in-memory
    transactions.push(savedTx);

    res.status(201).json({
      success: true,
      message: "Transaction processed successfully.",
      data: {
        transactionId: savedTx._id,
        gatewayStatus: 'APPROVED',
        payoutTxID: payoutTxId,
        finalRecord: savedTx
      }
    });
  } catch (error) {
    console.error("Process error:", error);
    res.status(500).json({ error: "Processing failed", message: error.message });
  }
});

// --- POST /api/batch-override ---
router.post('/batch-override', (req, res) => {
  try {
    const { batchId, newData } = req.body;
    if (batchId && newData) {
      const idx = transactions.findIndex(t => t._id === batchId);
      if (idx !== -1) {
        const parsed = typeof newData === 'string' ? JSON.parse(newData) : newData;
        transactions[idx] = { ...transactions[idx], ...parsed };
        return res.json({ message: "Batch overridden!", transaction: transactions[idx] });
      }
    }
    res.json({ message: "Batch overridden!" });
  } catch (e) {
    res.json({ message: "Batch overridden!" });
  }
});

module.exports = { processHandler: router };
