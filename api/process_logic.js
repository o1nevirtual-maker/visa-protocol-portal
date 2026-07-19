const express = require('express');
const router = express.Router();

// --- MOCK FUNCTIONS (no DB required) ---
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
router.get('/stats', (req, res) => {
  res.json({
    status: "active",
    uptime: process.uptime(),
    timestamp: Date.now(),
    totalTransactions: 5,
    grossRevenue: 1250.00,
    totalFees: 18.75
  });
});

// --- GET /api/transactions/:txId ---
router.get('/transactions/:txId', (req, res) => {
  res.json({
    note: "Mock mode",
    txId: req.params.txId,
    amount: 100.00,
    fee: 1.50,
    status: "mock"
  });
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

    res.status(201).json({
      success: true,
      message: "Transaction processed successfully.",
      data: {
        transactionId: 'MOCK-' + Date.now(),
        gatewayStatus: gatewayResult.status,
        payoutTxID: chainResult.tx_id,
        finalRecord: {
          _id: 'MOCK-' + Date.now(),
          card_number_masked: maskedCard,
          amount_usd: parseFloat(amount),
          fee_amount: 1.50,
          usdt_amount: parseFloat(usdtPayout),
          gateway_auth_code: gatewayResult.auth_code,
          gateway_status: gatewayResult.status,
          payout_confirmation: chainResult.tx_id,
          usdt_status_raw: chainResult.status
        }
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
