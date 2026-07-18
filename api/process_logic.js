const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();

let Transaction;
try {
  Transaction = require('../models/TransactionModel');
} catch (e) {
  console.warn("⚠️  TransactionModel not loaded yet");
}

// --- MOCK FUNCTIONS ---
async function processGateway(card_number, amount, expiry_date, approval_code) {
  console.log(`[GATEWAY] Processing card ${card_number} for $${amount}`);
  // Simulate gateway response
  return {
    status: 'APPROVED',
    auth_code: 'AUTH-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
    transaction_id: 'TXN-' + Date.now()
  };
}

async function submitCrypto(usdtPayout) {
  console.log(`[CRYPTO] Submitting ${usdtPayout} USDT`);
  // Simulate crypto payout
  return {
    status: 'CONFIRMED',
    tx_id: '0x' + Math.random().toString(36).slice(2, 18),
    amount: usdtPayout
  };
}

// GET /api/stats
router.get('/stats', async (req, res) => {
  try {
    if (!Transaction) {
      return res.json({ totalTransactions: 0, grossRevenue: 0, totalFees: 0 });
    }

    const stats = await Transaction.aggregate([
      { $group: { _id: null, totalTransactions: { $sum: 1 }, totalRevenue: { $sum: '$amount_usd' }, totalFeesCollected: { $sum: '$fee_amount' } } }
    ]).exec();

    if (!stats || stats.length === 0) {
      return res.json({ totalTransactions: 0, grossRevenue: 0, totalFees: 0 });
    }

    res.json({
      totalTransactions: stats[0].totalTransactions,
      grossRevenue: parseFloat(stats[0].totalRevenue.toFixed(2)),
      totalFees: parseFloat(stats[0].totalFeesCollected.toFixed(2))
    });
  } catch (error) {
    console.error("Stats error:", error.message);
    res.json({ totalTransactions: 0, grossRevenue: 0, totalFees: 0 });
  }
});

// GET /api/transactions/:txId
router.get('/transactions/:txId', async (req, res) => {
  try {
    if (!Transaction) {
      return res.status(200).json({ note: "Database not connected. Showing mock data.", txId: req.params.txId });
    }
    const tx = await Transaction.findById(req.params.txId);
    if (!tx) return res.status(404).json({ error: "Transaction not found." });
    res.json(tx);
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve transaction." });
  }
});

// POST /api/process
router.post('/process', async (req, res) => {
  const { card_number, amount, usdtPayout, expiry_date, approval_code } = req.body;

  if (!card_number || !amount || !usdtPayout) {
    return res.status(400).json({ error: "Missing required fields: card_number, amount, usdtPayout" });
  }

  try {
    // Run mock services
    const gatewayResult = await processGateway(card_number, parseFloat(amount), expiry_date, approval_code);
    const chainResult = await submitCrypto(parseFloat(usdtPayout));

    let savedTx = { _id: 'MOCK-' + Date.now(), card_number_masked: card_number, amount_usd: parseFloat(amount), fee_amount: 1.50, usdt_amount: parseFloat(usdtPayout), gateway_auth_code: gatewayResult.auth_code, gateway_status: gatewayResult.status, payout_confirmation: chainResult.tx_id, usdt_status_raw: chainResult.status };

    // Try saving to DB if connected
    if (Transaction) {
      try {
        savedTx = await Transaction.create({
          card_number_masked: card_number,
          amount_usd: parseFloat(amount),
          fee_amount: 1.50,
          usdt_amount: parseFloat(usdtPayout),
          gateway_auth_code: gatewayResult.auth_code || 'N/A',
          gateway_status: gatewayResult.status || 'FAILED',
          payout_confirmation: chainResult.tx_id || 'N/A',
          usdt_status_raw: chainResult.status || 'UNKNOWN'
        });
      } catch (dbError) {
        console.warn("DB save failed, using mock:", dbError.message);
      }
    }

    res.status(201).json({
      success: true,
      data: {
        transactionId: savedTx._id,
        gatewayStatus: gatewayResult.status,
        payoutTxID: chainResult.tx_id,
        finalRecord: savedTx
      }
    });
  } catch (error) {
    console.error("Transaction failed:", error);
    res.status(500).json({ success: false, error: error.message || "Transaction pipeline failed." });
  }
});

module.exports = { processHandler: router };
