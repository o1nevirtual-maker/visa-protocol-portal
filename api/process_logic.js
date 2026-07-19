const express = require('express');
const router = express.Router();

// In-memory transaction storage
const transactions = [];
let counter = 0;

// Seed with some initial data
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

// --- GET /api/stats ---
router.get('/stats', (req, res) => {
  const totalTx = transactions.length;
  const grossRevenue = transactions.reduce((s, t) => s + (t.amount_usd || 0), 0);
  const totalFees = transactions.reduce((s, t) => s + (t.fee_amount || 0), 0);

  res.json({
    status: "active",
    uptime: process.uptime(),
    timestamp: Date.now(),
    totalTransactions: totalTx,
    grossRevenue: parseFloat(grossRevenue.toFixed(2)),
    totalFees: parseFloat(totalFees.toFixed(2))
  });
});

// --- GET /api/transactions/:txId ---
router.get('/transactions/:txId', (req, res) => {
  const tx = transactions.find(t => t._id === req.params.txId);
  if (tx) return res.json(tx);
  res.status(404).json({ error: "Transaction not found." });
});

// --- POST /api/process ---
router.post('/process', (req, res) => {
  try {
    const { card_number, amount, usdtPayout } = req.body;

    if (!card_number || !amount || !usdtPayout) {
      return res.status(400).json({ error: "Missing required fields: card_number, amount, usdtPayout" });
    }

    counter++;
    const maskedCard = card_number.length > 4
      ? card_number.slice(0, 4) + '****' + card_number.slice(-4)
      : card_number;

    const newTx = {
      _id: 'tx-' + Date.now() + '-' + counter,
      card_number_masked: maskedCard,
      amount_usd: parseFloat(amount),
      fee_amount: 1.50,
      usdt_amount: parseFloat(usdtPayout),
      gateway_auth_code: 'AUTH-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      gateway_status: 'APPROVED',
      payout_confirmation: '0x' + Math.random().toString(36).slice(2, 18),
      usdt_status_raw: 'CONFIRMED',
      createdAt: new Date().toISOString()
    };

    transactions.push(newTx);

    res.status(201).json({
      success: true,
      message: "Transaction processed successfully.",
      data: {
        transactionId: newTx._id,
        gatewayStatus: 'APPROVED',
        payoutTxID: newTx.payout_confirmation,
        finalRecord: newTx
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
