const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();

let Transaction;
try {
  Transaction = require('../models/TransactionModel');
} catch (e) {
  console.warn("TransactionModel not loaded yet");
}

// --- SUBMIT TRANSACTION DATA (exported for index.html) ---
async function submitTransactionData(transactionData) {
  try {
    const response = await fetch('http://localhost:3000/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transactionData)
    });

    if (!response.ok) {
      const badText = await response.text();
      throw new Error(`Server Error (${response.status}): ${badText.substring(0, 50)}`);
    }

    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      throw new Error("Server did not reply with a valid JSON transaction receipt.");
    }

    const receipt = await response.json();
    console.log("Transaction successfully recorded:", receipt);
    return receipt;

  } catch (error) {
    console.error("Error inside process_logic.js:", error.message);
    // CRUCIAL: Throw so index.html can catch it and read the stack trace
    throw error;
  }
}

// --- MOCK FUNCTIONS ---
async function processGateway(card_number, amount, expiry_date, approval_code) {
  console.log(`[GATEWAY] Processing card ${card_number} for $${amount}`);
  return {
    status: 'APPROVED',
    auth_code: 'AUTH-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
    transaction_id: 'TXN-' + Date.now()
  };
}

async function submitCrypto(usdtPayout) {
  console.log(`[CRYPTO] Submitting ${usdtPayout} USDT`);
  return {
    status: 'CONFIRMED',
    tx_id: '0x' + Math.random().toString(36).slice(2, 18),
    amount: usdtPayout
  };
}

// --- GET /api/stats ---
router.get('/stats', async (req, res) => {
  try {
    if (!Transaction) {
      return res.json({
        status: "active (no DB)",
        uptime: process.uptime(),
        timestamp: Date.now(),
        totalTransactions: 0,
        grossRevenue: 0,
        totalFees: 0
      });
    }

    const stats = await Transaction.aggregate([
      { $group: { _id: null, totalTransactions: { $sum: 1 }, totalRevenue: { $sum: '$amount_usd' }, totalFeesCollected: { $sum: '$fee_amount' } } }
    ]).exec();

    if (!stats || stats.length === 0) {
      return res.json({
        status: "active",
        uptime: process.uptime(),
        timestamp: Date.now(),
        totalTransactions: 0,
        grossRevenue: 0,
        totalFees: 0
      });
    }

    res.json({
      status: "active",
      uptime: process.uptime(),
      timestamp: Date.now(),
      totalTransactions: stats[0].totalTransactions,
      grossRevenue: parseFloat(stats[0].totalRevenue.toFixed(2)),
      totalFees: parseFloat(stats[0].totalFeesCollected.toFixed(2))
    });
  } catch (error) {
    console.error("Backend stats crash:", error);
    return res.status(500).json({ error: "Internal Server Error", message: error.message });
  }
});

// --- GET /api/transactions/:txId ---
router.get('/transactions/:txId', async (req, res) => {
  try {
    if (!Transaction) {
      return res.json({ note: "Database not connected. Showing mock data.", txId: req.params.txId });
    }
    const tx = await Transaction.findById(req.params.txId);
    if (!tx) return res.status(404).json({ error: "Transaction not found." });
    res.json(tx);
  } catch (error) {
    res.status(500).json({ error: "Failed to retrieve transaction.", message: error.message });
  }
});

// --- POST /api/process ---
router.post('/process', async (req, res) => {
  try {
    const { card_number, amount, usdtPayout, expiry_date, approval_code } = req.body;

    if (!card_number || !amount || !usdtPayout) {
      return res.status(400).json({ error: "Missing required fields: card_number, amount, usdtPayout" });
    }

    // Run mock services
    const gatewayResult = await processGateway(card_number, parseFloat(amount), expiry_date, approval_code);
    const chainResult = await submitCrypto(parseFloat(usdtPayout));

    let savedTx = {
      _id: 'MOCK-' + Date.now(),
      card_number_masked: card_number,
      amount_usd: parseFloat(amount),
      fee_amount: 1.50,
      usdt_amount: parseFloat(usdtPayout),
      gateway_auth_code: gatewayResult.auth_code,
      gateway_status: gatewayResult.status,
      payout_confirmation: chainResult.tx_id,
      usdt_status_raw: chainResult.status
    };

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

    return res.status(201).json({
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
    console.error("Backend processing crash:", error);
    return res.status(500).json({ error: "Processing Failed", message: error.message });
  }
});

module.exports = { processHandler: router, submitTransactionData };
