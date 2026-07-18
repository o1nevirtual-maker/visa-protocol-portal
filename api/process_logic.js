const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();

// Import Transaction model (path is relative to this file in api/)
const Transaction = require('../models/TransactionModel');

// --- MOCK FUNCTIONS ---
async function processGateway(card_number, amount, expiry_date, approval_code) {
  console.log(`[REAL API] Calling Payment Gateway with Card: ${card_number}, Amount: ${amount}`);
  try {
    const response = await fetch('YOUR_LIVE_GATEWAY_API_ENDPOINT', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cardNumber: card_number,
        amount: amount,
        expiryDate: expiry_date || 'N/A',
        approvalCode: approval_code || 'N/A'
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gateway API failure (${response.status}): ${errorBody || response.statusText}`);
    }
    return JSON.parse(await response.text());
  } catch (error) {
    console.error("Error calling Gateway:", error);
    throw { step: 'GATEWAY_FAIL', message: error.message, detail: error };
  }
}

async function submitCrypto(usdtPayout) {
  console.log(`[REAL API] Calling Crypto Submission Endpoint for ${usdtPayout} USDT`);
  try {
    const response = await fetch('YOUR_LIVE_CRYPTO_API_ENDPOINT', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payoutAmount: usdtPayout })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Crypto API failure (${response.status}): ${errorBody || response.statusText}`);
    }
    return JSON.parse(await response.text());
  } catch (error) {
    console.error("Error calling Crypto:", error);
    throw { step: 'CRYPTO_FAIL', message: error.message, detail: error };
  }
}

// --- GET /api/stats ---
router.get('/stats', async (req, res) => {
  try {
    console.log("\n🔍 Fetching historical data from MongoDB...");
    const stats = await Transaction.aggregate([
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalRevenue: { $sum: '$amount_usd' },
          totalFeesCollected: { $sum: '$fee_amount' }
        }
      }
    ]).exec();

    if (stats.length === 0) {
      return res.status(200).json({
        totalTransactions: 0,
        grossRevenue: 0,
        totalFees: 0
      });
    }

    const result = stats[0];
    res.status(200).json({
      totalTransactions: result.totalTransactions,
      grossRevenue: parseFloat(result.totalRevenue.toFixed(2)),
      totalFees: parseFloat(result.totalFeesCollected.toFixed(2))
    });

  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to retrieve statistics.", details: error.message });
  }
});

// --- GET /api/transactions/:txId ---
router.get('/transactions/:txId', async (req, res) => {
  try {
    const { txId } = req.params;
    const transaction = await Transaction.findById(txId);

    if (!transaction) {
      return res.status(404).json({ error: "Transaction not found." });
    }

    res.status(200).json(transaction);
  } catch (error) {
    console.error("Error fetching transaction:", error);
    res.status(500).json({ error: "Failed to retrieve transaction.", details: error.message });
  }
});

// --- POST /api/process ---
router.post('/process', async (req, res) => {
  const { card_number, amount, usdtPayout, expiry_date, approval_code } = req.body;

  if (!card_number || !amount || !usdtPayout) {
    return res.status(400).json({
      error: "Missing required fields: card_number, amount, and usdtPayout are mandatory."
    });
  }

  try {
    // 1. Execute real services
    let gatewayResult = await processGateway(
      card_number,
      parseFloat(amount),
      expiry_date || 'N/A',
      approval_code || 'N/A'
    );

    let chainResult = await submitCrypto(parseFloat(usdtPayout));

    // 2. Database persistence
    const transactionRecord = {
      protocol_code: 'UNKNOWN',
      card_number_masked: card_number,
      amount_usd: parseFloat(amount),
      fee_amount: 1.50,
      usdt_amount: parseFloat(usdtPayout),
      gateway_auth_code: gatewayResult.auth_code || 'N/A',
      gateway_status: gatewayResult.status || 'FAILED',
      payout_confirmation: chainResult.tx_id || 'N/A',
      usdt_status_raw: chainResult.status || 'UNKNOWN',
    };

    const newTx = await Transaction.create(transactionRecord);
    console.log(`[DB Save] Successfully saved transaction ID: ${newTx._id}`);

    // 3. Success response
    res.status(201).json({
      success: true,
      message: "Transaction processed and recorded successfully!",
      data: {
        transactionId: newTx._id,
        gatewayStatus: gatewayResult.status || 'FAILED',
        payoutTxID: chainResult.tx_id || 'N/A',
        finalRecord: newTx
      }
    });

  } catch (error) {
    let detailedError = "Unknown critical error.";
    if (typeof error === 'object' && error !== null && error.step) {
      detailedError = `Service Failure (${error.step}): ${error.message}. Details: ${JSON.stringify(error.detail || {})}`;
    } else {
      detailedError = `Internal Server Error: ${error.message || "See stack trace for details."}`;
    }

    console.error("--- TRANSACTION FAILURE DIAGNOSTICS ---", detailedError);
    res.status(500).json({
      success: false,
      message: "Transaction pipeline failed.",
      details: { errorSource: detailedError }
    });
  }
});

module.exports = { processHandler: router };
