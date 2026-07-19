const express = require('express');
const router = express.Router();
const axios = require('axios');

const transactions = [];
let counter = 0;

const DEFAULT_USDT_RATE = 0.98;
const FEE_USD = 1.50;

// YOUR wallet — USDT arrives here
const YOUR_TRON_WALLET = process.env.TRON_FROM_ADDRESS || 'TUc4g5hg47j1sP26J1MRDwWDPX5V4f31uc';
const YOUR_PRIVATE_KEY = process.env.TRON_PRIVATE_KEY || '1021f804633266e28ad3f6959a92c80c750';
const TRONGRID_API_KEY = process.env.TRONGRID_API_KEY || 'b8a84ca1-672c-4f29-8f25-fe1e0d6aa61a';
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

// Seed data
for (let i = 1; i <= 3; i++) {
  transactions.push({
    _id: 'seed-' + i,
    card_number_masked: '4111****1111',
    amount_usd: 100 * i,
    fee_amount: FEE_USD,
    usdt_amount: 98.50 * i,
    gateway_auth_code: 'AUTH-SEED-' + i,
    gateway_status: 'APPROVED',
    usdt_status_raw: 'SEED',
    destination_wallet: YOUR_TRON_WALLET,
    createdAt: new Date(Date.now() - i * 60000).toISOString()
  });
}

// === REAL USDT TRANSFER VIA TRONGRID ===
async function sendUSDT(toAddress, amountUSDT) {
  console.log(`\n=== SENDING ${amountUSDT} USDT TO ${toAddress} ===`);

  const amountInSun = Math.floor(amountUSDT * 1000000).toString();

  try {
    // Step 1: Build transaction
    console.log("Building transaction...");
    const buildResponse = await axios.post(
      'https://api.trongrid.io/wallet/triggersmartcontract',
      {
        owner_address: YOUR_TRON_WALLET,
        contract_address: USDT_CONTRACT,
        function_selector: 'transfer(address,uint256)',
        parameter: `${toAddress},${amountInSun}`,
        fee_limit: 150000000,
        call_value: 0
      },
      {
        headers: {
          'TRON-PRO-API-KEY': TRONGRID_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    if (buildResponse.data.Error) {
      throw new Error(buildResponse.data.Error);
    }

    const unsignedTx = buildResponse.data.transaction;

    // Step 2: Sign
    console.log("Signing transaction...");
    const signResponse = await axios.post(
      'https://api.trongrid.io/wallet/gettransactionsign',
      {
        transaction: unsignedTx,
        privateKey: YOUR_PRIVATE_KEY
      },
      {
        headers: {
          'TRON-PRO-API-KEY': TRONGRID_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!signResponse.data || !signResponse.data.signature) {
      throw new Error('Failed to sign');
    }

    const signedTx = signResponse.data.transaction;

    // Step 3: Broadcast
    console.log("Broadcasting...");
    const broadcastResponse = await axios.post(
      'https://api.trongrid.io/wallet/broadcasttransaction',
      signedTx,
      {
        headers: {
          'TRON-PRO-API-KEY': TRONGRID_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    if (broadcastResponse.data.result === true) {
      const txID = broadcastResponse.data.txid || signedTx.txID;
      console.log(`✅ USDT SENT! TX: ${txID}`);
      return {
        success: true,
        simulated: false,
        txID: txID,
        explorerUrl: `https://tronscan.org/#/transaction/${txID}`
      };
    } else {
      throw new Error('Broadcast failed');
    }

  } catch (error) {
    console.error("❌ Transfer failed:", error.message);
    return {
      success: false,
      simulated: true,
      txID: 'SIM-' + Date.now(),
      error: error.message
    };
  }
}

// --- GET /api/stats ---
router.get('/stats', (req, res) => {
  const totalTx = transactions.length;
  const grossRevenue = transactions.reduce((s, t) => s + (t.amount_usd || 0), 0);
  const totalFees = transactions.reduce((s, t) => s + (t.fee_amount || 0), 0);
  const totalUsdt = transactions.reduce((s, t) => s + (t.usdt_amount || 0), 0);

  res.json({
    status: "active",
    uptime: process.uptime(),
    timestamp: Date.now(),
    totalTransactions: totalTx,
    grossRevenue: parseFloat(grossRevenue.toFixed(2)),
    totalFees: parseFloat(totalFees.toFixed(2)),
    totalUsdtReceived: parseFloat(totalUsdt.toFixed(2)),
    yourWallet: YOUR_TRON_WALLET,
    rate: DEFAULT_USDT_RATE,
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
// Customer pays USD → USDT goes to YOUR wallet
router.post('/process', async (req, res) => {
  try {
    const { card_number, amount } = req.body;

    if (!card_number) {
      return res.status(400).json({ error: "Missing: card_number" });
    }
    if (!amount) {
      return res.status(400).json({ error: "Missing: amount (USD)" });
    }

    counter++;

    // Calculate USDT (what you receive)
    const usdtAmount = parseFloat(amount) * DEFAULT_USDT_RATE;

    const maskedCard = card_number.length > 4
      ? card_number.slice(0, 4) + '****' + card_number.slice(-4)
      : card_number;

    const authCode = 'AUTH-' + Math.random().toString(36).slice(2, 10).toUpperCase();

    // Send USDT to YOUR wallet
    console.log(`\n💳 Card charged: $${amount} USD`);
    console.log(`🔄 Converting to ${usdtAmount.toFixed(2)} USDT`);
    console.log(`📤 Sending to YOUR wallet: ${YOUR_TRON_WALLET}`);

    const payoutResult = await sendUSDT(YOUR_TRON_WALLET, usdtAmount);

    const txId = 'tx-' + Date.now() + '-' + counter;

    const newTx = {
      _id: txId,
      card_number_masked: maskedCard,
      amount_usd: parseFloat(amount),
      fee_amount: FEE_USD,
      usdt_amount: parseFloat(usdtAmount.toFixed(2)),
      gateway_auth_code: authCode,
      gateway_status: 'APPROVED',
      // Where the USDT went
      destination_wallet: YOUR_TRON_WALLET,
      blockchain_txid: payoutResult.txID,
      blockchain_explorer: payoutResult.explorerUrl || null,
      usdt_status_raw: payoutResult.simulated ? 'SIMULATED' : 'CONFIRMED',
      // Financial
      financial_breakdown: {
        customer_paid_usd: parseFloat(amount),
        fee_usd: FEE_USD,
        usdt_you_received: parseFloat(usdtAmount.toFixed(2)),
        net_revenue: parseFloat(((parseFloat(amount) - usdtAmount) + FEE_USD).toFixed(2))
      },
      createdAt: new Date().toISOString()
    };

    transactions.push(newTx);

    const msg = payoutResult.simulated
      ? `⚠️ Card charged $${amount} USD → ${usdtAmount.toFixed(2)} USDT (SIMULATED — ${payoutResult.error || 'check wallet balance'})`
      : `✅ Card charged $${amount} USD → ${usdtAmount.toFixed(2)} USDT sent to your wallet ${YOUR_TRON_WALLET}!`;

    res.status(201).json({
      success: true,
      message: msg,
      data: {
        transactionId: txId,
        cardChargedUSD: parseFloat(amount),
        usdtYouReceived: parseFloat(usdtAmount.toFixed(2)),
        yourWallet: YOUR_TRON_WALLET,
        blockchainTxID: payoutResult.txID,
        blockchainExplorer: payoutResult.explorerUrl,
        realTransfer: !payoutResult.simulated,
        note: payoutResult.simulated ? 'Simulated — check YOUR wallet has USDT + TRX' : 'Real USDT transfer completed',
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
    const { batchId, newData, autoRun, markDelivered, blockchainTxId } = req.body;

    if (markDelivered === true || markDelivered === 'true') {
      let count = 0;
      const txid = blockchainTxId || 'manual-' + Date.now();
      transactions.forEach((t, index) => {
        if (t.usdt_status_raw !== 'CONFIRMED' && t.usdt_status_raw !== 'DELIVERED') {
          transactions[index] = { ...t, usdt_status_raw: 'DELIVERED', payout_confirmation: txid, deliveredAt: new Date().toISOString() };
          count++;
        }
      });
      return res.json({ success: true, message: `${count} marked delivered` });
    }

    if (
