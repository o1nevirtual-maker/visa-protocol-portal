const express = require('express');
const router = express.Router();

const transactions = [];
let counter = 0;

const USDT_RATE = 0.98;
const FEE_USD = 1.50;

// Your wallet for record-keeping
const YOUR_WALLET = process.env.TRON_FROM_ADDRESS || 'TUc4g5hg47j1sP26J1MRDwWDPX5V4f31uc';

// Seed data
for (let i = 1; i <= 3; i++) {
  transactions.push({
    _id: 'seed-' + i,
    card_number_masked: '4111****1111',
    amount_usd: 100 * i,
    fee_amount: FEE_USD,
    usdt_amount: 98.50 * i,
    usdt_destination: YOUR_WALLET,
    gateway_status: 'APPROVED',
    status: 'RECORDED',
    createdAt: new Date(Date.now() - i * 60000).toISOString()
  });
}

// --- GET /api/stats ---
router.get('/stats', (req, res) => {
  const total = transactions.length;
  const revenue = transactions.reduce((s, t) => s + (t.amount_usd || 0), 0);
  const fees = transactions.reduce((s, t) => s + (t.fee_amount || 0), 0);
  const usdt = transactions.reduce((s, t) => s + (t.usdt_amount || 0), 0);

  res.json({
    status: "active",
    totalTransactions: total,
    grossRevenueUSD: parseFloat(revenue.toFixed(2)),
    totalFeesUSD: parseFloat(fees.toFixed(2)),
    totalUSDTToReceive: parseFloat(usdt.toFixed(2)),
    yourWallet: YOUR_WALLET,
    rate: USDT_RATE,
    feePerTx: FEE_USD
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
    const { card_number, amount } = req.body;

    if (!card_number) return res.status(400).json({ error: "Missing: card_number" });
    if (!amount) return res.status(400).json({ error: "Missing: amount" });

    counter++;

    const usdtAmount = parseFloat(amount) * USDT_RATE;
    const masked = card_number.length > 4
      ? card_number.slice(0, 4) + '****' + card_number.slice(-4)
      : card_number;

    const txId = 'tx-' + Date.now() + '-' + counter;

    const record = {
      _id: txId,
      card_number_masked: masked,
      amount_usd: parseFloat(amount),
      fee_amount: FEE_USD,
      usdt_amount: parseFloat(usdtAmount.toFixed(2)),
      usdt_destination: YOUR_WALLET,
      gateway_auth_code: 'AUTH-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      gateway_status: 'APPROVED',
      status: 'RECORDED',
      note: 'USDT delivery handled by third-party processor',
      createdAt: new Date().toISOString()
    };

    transactions.push(record);

    res.status(201).json({
      success: true,
      message: `✅ $${amount} USD charged → ${usdtAmount.toFixed(2)} USDT recorded for your wallet ${YOUR_WALLET}`,
      data: record
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- POST /api/batch-override ---
router.post('/batch-override', (req, res) => {
  try {
    const { batchId, newData, autoRun } = req.body;

    if (autoRun) {
      const data = typeof newData === 'string' ? JSON.parse(newData) : (newData || {});
      transactions.forEach((t, i) => { transactions[i] = { ...t, ...data }; });
      return res.json({ message: `All ${transactions.length} updated` });
    }

    if (batchId && newData) {
      const idx = transactions.findIndex(t => t._id === batchId);
      if (idx === -1) return res.status(404).json({ error: "Not found" });
      const data = typeof newData === 'string' ? JSON.parse(newData) : newData;
      transactions[idx] = { ...transactions[idx], ...data };
      return res.json({ message: "Updated", transaction: transactions[idx] });
    }

    res.json({
      total: transactions.length,
      yourWallet: YOUR_WALLET
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { processHandler: router };
