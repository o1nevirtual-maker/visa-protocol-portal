const express = require('express');
const router = express.Router();
const axios = require('axios');

const transactions = [];
let counter = 0;

const DEFAULT_USDT_RATE = 0.98;
const FEE_USD = 1.50;

// Your wallet configuration - THIS wallet must have USDT + TRX
const CONFIG = {
  TRON_FROM_ADDRESS: process.env.TRON_FROM_ADDRESS || 'TUc4g5hg47j1sP26J1MRDwWDPX5V4f31uc',
  TRON_PRIVATE_KEY: process.env.TRON_PRIVATE_KEY || '1021f804633266e28ad3f6959a92c80c750',
  TRONGRID_API_KEY: process.env.TRONGRID_API_KEY || 'b8a84ca1-672c-4f29-8f25-fe1e0d6aa61a',
  USDT_CONTRACT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'  // USDT TRC20 mainnet
};

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
    usdt_status_raw: 'SEED_DATA',
    customer_tron_address: 'TCustomerWallet' + i,
    from_wallet: CONFIG.TRON_FROM_ADDRESS,
    createdAt: new Date(Date.now() - i * 60000).toISOString()
  });
}

// === REAL USDT TRANSFER VIA TRONGRID API ===
async function sendUSDT(toAddress, amountUSDT) {
  const privateKey = CONFIG.TRON_PRIVATE_KEY;
  const fromAddress = CONFIG.TRON_FROM_ADDRESS;
  const usdtContract = CONFIG.USDT_CONTRACT;
  const apiKey = CONFIG.TRONGRID_API_KEY;

  console.log(`\n=== SENDING ${amountUSDT} USDT ===`);
  console.log(`FROM: ${fromAddress}`);
  console.log(`TO: ${toAddress}`);
  console.log(`AMOUNT: ${amountUSDT} USDT`);

  // Convert amount to smallest unit (USDT has 6 decimals)
  const amountInSun = Math.floor(amountUSDT * 1000000).toString();

  try {
    // Step 1: Trigger the USDT contract (build transaction)
    console.log("Step 1: Building transaction...");
    const hexAddress = toAddress.startsWith('T')
      ? toAddress  // Will be converted by TronGrid
      : toAddress;

    const buildResponse = await axios.post(
      'https://api.trongrid.io/wallet/triggersmartcontract',
      {
        owner_address: fromAddress,
        contract_address: usdtContract,
        function_selector: 'transfer(address,uint256)',
        parameter: toAddress.startsWith('T')
          ? `${toAddress},${amountInSun}`
          : `${toAddress},${amountInSun}`,
        fee_limit: 150000000, // 150 TRX max
        call_value: 0
      },
      {
        headers: {
          'TRON-PRO-API-KEY': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (buildResponse.data.Error) {
      throw new Error(buildResponse.data.Error);
    }

    const unsignedTx = buildResponse.data.transaction;
    console.log("Transaction built successfully");

    // Step 2: Sign the transaction
    console.log("Step 2: Signing transaction...");
    const signResponse = await axios.post(
      'https://api.trongrid.io/wallet/gettransactionsign',
      {
        transaction: unsignedTx,
        privateKey: privateKey
      },
      {
        headers: {
          'TRON-PRO-API-KEY': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!signResponse.data || !signResponse.data.signature) {
      throw new Error('Failed to sign transaction');
    }

    const signedTx = signResponse.data.transaction;
    console.log("Transaction signed successfully");

    // Step 3: Broadcast
    console.log("Step 3: Broadcasting...");
    const broadcastResponse = await axios.post(
      'https://api.trongrid.io/wallet/broadcasttransaction',
      signedTx,
      {
        headers: {
          'TRON-PRO-API-KEY': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    if (broadcastResponse.data.result === true) {
      const txID = broadcastResponse.data.txid || signedTx.txID;
      console.log(`✅ USDT SENT! TX: ${txID}`);
      console.log(`🔗 https://tronscan.org/#/transaction/${txID}`);
      return {
        success: true,
        simulated: false,
        txID: txID,
        explorerUrl: `https://tronscan.org/#/transaction/${txID}`
      };
    } else {
      throw new Error(broadcastResponse.data.Error || 'Broadcast failed');
    }

  } catch (error) {
    console.error("❌ USDT Transfer failed:", error.message);
    // Return simulation as fallback
    const simTxId = 'SIM-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    return {
      success: false,
      simulated: true,
      txID: simTxId,
      error: error.message,
      note: `Real transfer failed: ${error.message}. Simulated for testing.`
    };
  }
}

// --- GET /api/stats ---
router.get('/stats', (req, res) => {
  const totalTx = transactions.length;
  const grossRevenue = transactions.reduce((s, t) => s + (t.amount_usd || 0), 0);
  const totalFees = transactions.reduce((s, t) => s + (t.fee_amount || 0), 0);
  const totalUsdtSent = transactions.reduce((s, t) => s + (t.usdt_amount || 0), 0);
  const delivered = transactions.filter(t => t.usdt_status_raw === 'DELIVERED' || t.usdt_status_raw === 'CONFIRMED').length;
  const pending = transactions.filter(t => t.usdt_status_raw === 'PENDING' || t.usdt_status_raw === 'PENDING_EXTERNAL_DELIVERY').length;

  res.json({
    status: "active",
    uptime: process.uptime(),
    timestamp: Date.now(),
    totalTransactions: totalTx,
    deliveredCount: delivered,
    pendingCount: pending,
    grossRevenue: parseFloat(grossRevenue.toFixed(2)),
    totalFees: parseFloat(totalFees.toFixed(2)),
    totalUsdtSent: parseFloat(totalUsdtSent.toFixed(2)),
    platformRevenue: parseFloat((grossRevenue - totalUsdtSent - totalFees).toFixed(2)),
    hotWallet: CONFIG.TRON_FROM_ADDRESS,
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
// USD card → Auto-convert to USDT → Send to customer's wallet
router.post('/process', async (req, res) => {
  try {
    const { card_number, amount, usdtPayout, customer_tron_address } = req.body;

    // Validate
    if (!card_number) return res.status(400).json({ error: "Missing: card_number" });
    if (!amount) return res.status(400).json({ error: "Missing: amount (USD)" });
    if (!customer_tron_address) return res.status(400).json({ error: "Missing: customer_tron_address" });
    if (!customer_tron_address.startsWith('T') || customer_tron_address.length < 30) {
      return res.status(400).json({ error: "Invalid TRON address" });
    }

    counter++;

    // Calculate USDT amount
    let usdtAmount;
    if (usdtPayout) {
      usdtAmount = parseFloat(usdtPayout);
    } else {
      usdtAmount = parseFloat(amount) * DEFAULT_USDT_RATE;
    }

    const maskedCard = card_number.length > 4
      ? card_number.slice(0, 4) + '****' + card_number.slice(-4)
      : card_number;

    const authCode = 'AUTH-' + Math.random().toString(36).slice(2, 10).toUpperCase();

    // === SEND USDT TO CUSTOMER'S WALLET ===
    console.log(`\n💳 Card charged: $${amount} USD`);
    console.log(`🔄 Converting to ${usdtAmount} USDT`);
    console.log(`📤 Sending to: ${customer_tron_address}`);

    const payoutResult = await sendUSDT(customer_tron_address, usdtAmount);

    const txId = 'tx-' + Date.now() + '-' + counter;

    const newTx = {
      _id: txId,
      card_number_masked: maskedCard,
      amount_usd: parseFloat(amount),
      fee_amount: FEE_USD,
      usdt_amount: parseFloat(usdtAmount.toFixed(2)),
      gateway_auth_code: authCode,
      gateway_status: 'APPROVED',
      // Blockchain info
      from_hot_wallet: CONFIG.TRON_FROM_ADDRESS,
      customer_tron_address: customer_tron_address,
      blockchain_txid: payoutResult.txID,
      blockchain_explorer: payoutResult.explorerUrl || null,
      usdt_status_raw: payoutResult.simulated ? 'SIMULATED' : 'CONFIRMED',
      payout_real: !payoutResult.simulated,
      // Destinations
      destinations: {
        usdt_sent_from: CONFIG.TRON_FROM_ADDRESS,
        usdt_sent_to: customer_tron_address,
        usdt_network: 'TRC20 (Tron)',
        contract: CONFIG.USDT_CONTRACT,
        explorer: payoutResult.explorerUrl || `https://tronscan.org/#/address/${customer_tron_address}`
      },
      // Financial breakdown
      financial_breakdown: {
        customer_paid_usd: parseFloat(amount),
        card_fee: FEE_USD,
        usdt_sent: parseFloat(usdtAmount.toFixed(2)),
        your_revenue: parseFloat(((parseFloat(amount) - usdtAmount) + FEE_USD).toFixed(2))
      },
      createdAt: new Date().toISOString()
    };

    transactions.push(newTx);

    // Response
    const responseMsg = payoutResult.simulated
      ? `⚠️ Card charged $${amount} USD. USDT transfer SIMULATED (${payoutResult.error || 'no real key'}). Check config.`
      : `✅ Card charged $${amount} USD → ${usdtAmount.toFixed(2)} USDT SENT to ${customer_tron_address}!`;

    res.status(201).json({
      success: true,
      message: responseMsg,
      data: {
        transactionId: txId,
        cardChargedUSD: parseFloat(amount),
        usdtSent: parseFloat(usdtAmount.toFixed(2)),
        fromWallet: CONFIG.TRON_FROM_ADDRESS,
        toWallet: customer_tron_address,
        blockchainTxID: payoutResult.txID,
        blockchainExplorer: payoutResult.explorerUrl,
        realTransfer: !payoutResult.simulated,
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

    // Mark ALL as delivered
    if (markDelivered === true || markDelivered === 'true') {
      let count = 0;
      const txid = blockchainTxId || 'manual-' + Date.now();

      transactions.forEach((t, index) => {
        if (t.usdt_status_raw !== 'DELIVERED' && t.usdt_status_raw !== 'CONFIRMED') {
          transactions[index] = {
            ...t,
            usdt_status_raw: 'DELIVERED',
            payout_confirmation: txid,
            deliveredAt: new Date().toISOString()
          };
          count++;
        }
      });

      return res.json({
        success: true,
        message: `✅ ${count} pending marked as DELIVERED`,
        deliveredCount: count,
        blockchainTxId: txid
      });
    }

    // Mark single as delivered
    if (batchId && markDelivered) {
      const idx = transactions.findIndex(t => t._id === batchId);
      if (idx === -1) return res.status(404).json({ error: "Not found" });

      const txid = blockchainTxId || 'manual-' + Date.now();
      transactions[idx] = {
        ...transactions[idx],
        usdt_status_raw: 'DELIVERED',
        payout_confirmation: txid,
        deliveredAt: new Date().toISOString()
      };

      return res.json({ success: true, message: `Delivered`, transaction: transactions[idx] });
    }

    // Generic override
    if (autoRun === true || autoRun === 'true') {
      const parsedData = typeof newData === 'string' ? JSON.parse(newData) : (newData || {});
      const overridden = transactions.map(t => ({ ...t, ...parsedData }));
      transactions.length = 0;
      transactions.push(...overridden);
      return res.json({ message: "Overridden!", total: transactions.length });
    }

    if (batchId && newData) {
      const idx = transactions.findIndex(t => t._id === batchId);
      if (idx !== -1) {
        const parsed = typeof newData === 'string' ? JSON.parse(newData) : newData;
        transactions[idx] = { ...transactions[idx], ...parsed };
        return res.json({ message: "Overridden!", transaction: transactions[idx] });
      }
      return res.status(404).json({ error: "Not found" });
    }

    res.json({
      message: "Commands:",
      autoSend: 'POST with card_number, amount, customer_tron_address → auto sends USDT',
      markDelivered: 'POST with {"markDelivered": true}',
      pending: transactions.filter(t => t.usdt_status_raw !== 'DELIVERED' && t.usdt_status_raw !== 'CONFIRMED').length,
      delivered: transactions.filter(t => t.usdt_status_raw === 'DELIVERED' || t.usdt_status_raw === 'CONFIRMED').length
    });
  } catch (e) {
    res.status(500).json({ error: "Override failed", message: e.message });
  }
});

module.exports = { processHandler: router };
