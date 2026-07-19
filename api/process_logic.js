const express = require('express');
const router = express.Router();

// In-memory storage
const transactions = [];
let counter = 0;

// Configuration from environment
const CONFIG = {
  TRON_FROM_ADDRESS: process.env.TRON_FROM_ADDRESS || 'TUc4g5hg47j1sP26J1MRDwWDPX5V4f31uc',
  GATEWAY_API_KEY: process.env.GATEWAY_API_KEY || 'vck_7AY3GMJ6dve9qFJLORLrmtqQlhLp3DsQ',
  TRONGRID_API_KEY: process.env.TRONGRID_API_KEY || 'b8a84ca1-672c-4f29-8f25-fe1e0d6aa61a',
  TRON_PRIVATE_KEY: process.env.TRON_PRIVATE_KEY || '1021f804633266e28ad3f6959a92c80c750>',
  MERCHANT_ACCOUNT: 'merchant-visa-portal-001',  // Gateway merchant ID
  DEFAULT_USDT_RATE: 0.98  // 98% — 2% spread
};

// Seed data
for (let i = 1; i <= 3; i++) {
  transactions.push({
    _id: 'seed-' + i,
    card_number_masked: '4111****1111',
    amount_usd: 100 * i,
    fee_amount: 1.50,
    usdt_amount: 98.50 * i,
    gateway_auth_code: 'AUTH-SEED-' + i,
    gateway_status: 'APPROVED',
    payout_confirmation: '0xseed' + i,
    usdt_status_raw: 'CONFIRMED',
    // DESTINATION TRACKING
    destinations: {
      usdt_sent_to: CONFIG.TRON_FROM_ADDRESS,
      usdt_network: 'TRC20 (Tron)',
      gateway_destination: CONFIG.MERCHANT_ACCOUNT,
      fee_collector: 'system-fee-wallet-001'
    },
    createdAt: new Date(Date.now() - i * 60000).toISOString()
  });
}

// --- GET /api/stats ---
router.get('/stats', (req, res) => {
  const totalTx = transactions.length;
  const grossRevenue = transactions.reduce((s, t) => s + (t.amount_usd || 0), 0);
  const totalFees = transactions.reduce((s, t) => s + (t.fee_amount || 0), 0);
  const totalUsdtPaid = transactions.reduce((s, t) => s + (t.usdt_amount || 0), 0);

  res.json({
    status: "active",
    uptime: process.uptime(),
    timestamp: Date.now(),
    totalTransactions: totalTx,
    grossRevenue: parseFloat(grossRevenue.toFixed(2)),
    totalFees: parseFloat(totalFees.toFixed(2)),
    totalUsdtPaidOut: parseFloat(totalUsdtPaid.toFixed(2)),
    spread: parseFloat((grossRevenue - totalUsdtPaid - totalFees).toFixed(2)),
    network: {
      usdt_network: 'TRC20',
      payout_address: CONFIG.TRON_FROM_ADDRESS,
      gateway_merchant: CONFIG.MERCHANT_ACCOUNT
    }
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

    if (!card_number || !amount) {
      return res.status(400).json({ error: "Missing required fields: card_number, amount" });
    }

    counter++;

    // Auto-calculate USDT if not provided, otherwise use provided value
    let usdtAmount;
    let usdtCalcMethod;
    if (usdtPayout !== undefined && usdtPayout !== null) {
      usdtAmount = parseFloat(usdtPayout);
      usdtCalcMethod = 'manual';
    } else {
      // Auto-calculate: USD × rate - fee
      usdtAmount = parseFloat(amount) * CONFIG.DEFAULT_USDT_RATE - 1.50;
      usdtCalcMethod = `auto (${CONFIG.DEFAULT_USDT_RATE * 100}% rate)`;
    }

    const maskedCard = card_number.length > 4
      ? card_number.slice(0, 4) + '****' + card_number.slice(-4)
      : card_number;

    const authCode = 'AUTH-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    const payoutTxId = '0x' + Math.random().toString(36).slice(2, 18);

    const spread = parseFloat(amount) - usdtAmount - 1.50;

    const newTx = {
      _id: 'tx-' + Date.now() + '-' + counter,
      card_number_masked: maskedCard,
      amount_usd: parseFloat(amount),
      fee_amount: 1.50,
      usdt_amount: parseFloat(usdtAmount.toFixed(2)),
      usdt_calculation: usdtCalcMethod,
      gateway_auth_code: authCode,
      gateway_status: 'APPROVED',
      payout_confirmation: payoutTxId,
      usdt_status_raw: 'CONFIRMED',
      // DESTINATION TRACKING
      destinations: {
        usdt_sent_to: CONFIG.TRON_FROM_ADDRESS,
        usdt_network: 'TRC20 (Tron)',
        gateway_destination: CONFIG.MERCHANT_ACCOUNT,
        fee_collector: 'system-fee-wallet-001',
        spread_kept_by: 'platform (you)'
      },
      financial_breakdown: {
        customer_paid_usd: parseFloat(amount),
        fee_usd: 1.50,
        usdt_paid_out: parseFloat(usdtAmount.toFixed(2)),
        platform_spread_usd: parseFloat(spread.toFixed(2)),
        spread_percentage: ((spread / parseFloat(amount)) * 100).toFixed(2) + '%'
      },
      createdAt: new Date().toISOString()
    };

    transactions.push(newTx);

    res.status(201).json({
      success: true,
      message: "Transaction processed successfully.",
      data: {
        transactionId: newTx._id,
        gatewayStatus: 'APPROVED',
        payoutTxID: payoutTxId,
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
    const { batchId, newData, autoRun } = req.body;

    // Auto-run mode: override ALL transactions
    if (autoRun === true || autoRun === 'true') {
      const parsedData = typeof newData === 'string' ? JSON.parse(newData) : (newData || {});
      const overridden = transactions.map(t => ({ ...t, ...parsedData }));
      transactions.length = 0;
      transactions.push(...overridden);
      return res.json({
        message: "Batch auto-override completed!",
        totalOverridden: transactions.length,
        sampleRecord: transactions[0] || null
      });
    }

    // Single transaction override
    if (batchId && newData) {
      const idx = transactions.findIndex(t => t._id === batchId);
      if (idx !== -1) {
        const parsed = typeof newData === 'string' ? JSON.parse(newData) : newData;
        transactions[idx] = { ...transactions[idx], ...parsed };
        return res.json({
          message: "Batch overridden!",
          transaction: transactions[idx]
        });
      }
      return res.status(404).json({ error: "Transaction ID not found" });
    }

    // Return current list if no action
    res.json({
      message: "Send batchId + newData (single) or autoRun=true + newData (all)",
      totalTransactions: transactions.length
    });
  } catch (e) {
    res.status(500).json({ error: "Override failed", message: e.message });
  }
});

module.exports = { processHandler: router };
