const express = require('express');
const router = express.Router();
const connectDB = require('./dbConnect');

let Transaction = null;

// Lazy-load Transaction model only when DB is connected
async function getTransaction() {
  if (Transaction) return Transaction;
  try {
    const db = await connectDB();
    if (db) {
      const getModel = require('../models/TransactionModel');
      Transaction = getModel();
    }
  } catch (e) {
    // Silent fail - stay in mock mode
  }
  return Transaction;
}

// --- MOCK FUNCTIONS ---
async function processGateway(card_number, amount, expiry_date, approval_code) {
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
    const Tx = await getTransaction();

    if (Tx) {
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
    }
  } catch (e) {
    console.warn("Stats from DB failed, using mock:", e.message);
  }

  // Fallback to mock stats
  res.json({
    status: "active (mock mode)",
    uptime: process.uptime(),
    timestamp: Date.now(),
    totalTransactions: 5,
    grossRevenue: 1250.00,
    totalFees: 18.75
  });
});

// --- GET /api/transactions/:txId ---
router.get('/transactions/:txId', async (req, res) => {
  try {
    const Tx = await getTransaction();
    if (Tx) {
      const tx = await Tx.findById(req.params.txId);
      if (tx) return res.json(tx);
    }
  } catch (e) {
    console.warn("Transaction fetch failed:", e.message);
  }

  // Fallback
  res.json({ note: "Mock mode", txId: req.params.txId, amount: 100.00, fee: 1.50 });
});

// --- POST /api/process ---
router.post('/process', async (req, res) => {
  try {
    const { card_number, amount, usdtPayout, expiry_date, approval_code } = req.body;

    if (!card_number || !amount || !usdtPayout) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const gatewayResult = await processGateway(card_number, parseFloat(amount), expiry_date, approval_code);
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

    let savedTx = { _id: 'MOCK-' + Date.now(), ...record };

    // Try to save to DB
    try {
      const Tx = await getTransaction();
      if (Tx) {
        savedTx = await Tx.create(record);
      }
    } catch (dbError) {
      console.warn("DB save failed, using mock:", dbError.message);
    }

    res.status(201).json({
      success: true,
      message: "Transaction processed successfully.",
      data: {
        transactionId: savedTx._id,
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
  res.json({ message: "Batch overridden successfully!" });
});

module.exports = { processHandler: router };
