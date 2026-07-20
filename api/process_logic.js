const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  TRANSAK_API_KEY:   process.env.TRANSAK_API_KEY    || 'bf3e985a-a0b1-4458-981b-e3e2c186e78e',
  TRANSAK_SECRET:    process.env.TRANSAK_SECRET     || 'PLSmUce3MrGEhpNwMVZhEQ==',
  YOUR_TRON_WALLET:  process.env.TRON_FROM_ADDRESS  || 'TUc4g5hg47j1sP26J1MRDwWDPX5V4f31uc',
  REFERRER_DOMAIN:   'visa-portal-two.vercel.app',
  BASE_URL:          'https://visa-portal-two.vercel.app',
  FEE_USD:           1.50
};

// Vercel KV (Redis via REST API)
const KV_REST_API_URL  = process.env.KV_REST_API_URL  || '';
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || '';

const startTime = Date.now();
let counter = 0;
let cachedAccessToken = null;
let tokenExpiry = 0;

// ============================================================
// PERSISTENT STORAGE HELPERS (Vercel KV)
// ============================================================

async function kvSet(key, value) {
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) return false;
  try {
    await axios.post(`${KV_REST_API_URL}/set/${key}`, JSON.stringify(value), {
      headers: {
        'Authorization': `Bearer ${KV_REST_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      httpsAgent: new https.Agent({ keepAlive: true })
    });
    return true;
  } catch (e) {
    console.warn('KV set failed:', e.message);
    return false;
  }
}

async function kvGet(key) {
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) return null;
  try {
    const res = await axios.get(`${KV_REST_API_URL}/get/${key}`, {
      headers: { 'Authorization': `Bearer ${KV_REST_API_TOKEN}` },
      httpsAgent: new https.Agent({ keepAlive: true })
    });
    return res.data.result;
  } catch (e) {
    console.warn('KV get failed:', e.message);
    return null;
  }
}

async function kvDel(key) {
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) return false;
  try {
    await axios.delete(`${KV_REST_API_URL}/del/${key}`, {
      headers: { 'Authorization': `Bearer ${KV_REST_API_TOKEN}` },
      httpsAgent: new https.Agent({ keepAlive: true })
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function kvList(prefix) {
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) return [];
  try {
    const res = await axios.get(`${KV_REST_API_URL}/keys?prefix=${prefix}`, {
      headers: { 'Authorization': `Bearer ${KV_REST_API_TOKEN}` },
      httpsAgent: new https.Agent({ keepAlive: true })
    });
    return res.data.result || [];
  } catch (e) {
    return [];
  }
}

// ============================================================
// TRANSACTION CRUD
// ============================================================

async function getAllTransactions() {
  const keys = await kvList('tx:');
  const txs = [];
  for (const key of keys) {
    const tx = await kvGet(key);
    if (tx) {
      try { txs.push(typeof tx === 'string' ? JSON.parse(tx) : tx); }
      catch { txs.push(tx); }
    }
  }
  // Always include seed data
  const seedCount = await kvGet('seed:count');
  if (!seedCount) {
    const seeds = [];
    for (let i = 1; i <= 3; i++) {
      const seed = {
        transactionId: 'seed-' + i,
        gatewayStatus: 'SEED',
        gateway_auth_code: 'AUTH-SEED-' + i,
        amount_usd: 100 * i,
        fee_amount: CONFIG.FEE_USD,
        usdt_amount: parseFloat((100 * i * 0.98).toFixed(2)),
        usdt_destination: CONFIG.YOUR_TRON_WALLET,
        payoutTxID: null,
        finalRecord: { status: 'SEED', note: 'Seed data entry' },
        created_at: Date.now() - i * 60000
      };
      seeds.push(seed);
      await kvSet('tx:seed-' + i, seed);
    }
    await kvSet('seed:count', 3);
    txs.push(...seeds);
  }
  return txs;
}

async function saveTransaction(tx) {
  await kvSet('tx:' + tx.transactionId, tx);
  await kvSet('counter:last', Date.now());
}

async function findTransaction(txId) {
  // Try KV first
  const tx = await kvGet('tx:' + txId);
  if (tx) {
    try { return typeof tx === 'string' ? JSON.parse(tx) : tx; }
    catch { return tx; }
  }
  // Fallback: search all
  const all = await getAllTransactions();
  return all.find(t => t.transactionId === txId || t._id === txId) || null;
}

// ============================================================
// TRANSAK HELPERS
// ============================================================

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiry) return cachedAccessToken;
  const res = await axios.post(
    'https://api-stg.transak.com/partners/api/v2/refresh-token',
    { apiKey: CONFIG.TRANSAK_API_KEY },
    {
      headers: {
        'api-secret':    CONFIG.TRANSAK_SECRET,
        'Content-Type':  'application/json',
        'accept':        'application/json'
      }
    }
  );
  cachedAccessToken = res.data.data.accessToken;
  tokenExpiry = Date.now() + 6 * 24 * 60 * 60 * 1000;
  return cachedAccessToken;
}

async function getQuote(amountUSD) {
  const res = await axios.get(
    'https://api-gateway-stg.transak.com/api/v2/lookup/quotes',
    {
      params: {
        apiKey:         CONFIG.TRANSAK_API_KEY,
        fiatCurrency:   'USD',
        cryptoCurrency: 'USDT',
        isBuyOrSell:    'BUY',
        fiatAmount:     amountUSD,
        network:        'tron',
        paymentMethod:  'credit_debit_card'
      },
      headers: { 'x-api-key': CONFIG.TRANSAK_API_KEY, 'x-user-ip': '0.0.0.0' }
    }
  );
  return res.data.data;
}

async function createWidgetSession(usdAmount, partnerOrderId) {
  const token = await getAccessToken();
  const res = await axios.post(
    'https://api-gateway-stg.transak.com/api/v2/auth/session',
    {
      widgetParams: {
        apiKey:                   CONFIG.TRANSAK_API_KEY,
        referrerDomain:           CONFIG.REFERRER_DOMAIN,
        productsAvailed:          'BUY',
        fiatCurrency:             'USD',
        fiatAmount:               usdAmount,
        cryptoCurrencyCode:       'USDT',
        network:                  'tron',
        paymentMethod:            'credit_debit_card',
        walletAddress:            CONFIG.YOUR_TRON_WALLET,
        disableWalletAddressForm: true,
        hideExchangeScreen:       true,
        partnerOrderId:           partnerOrderId,
        redirectURL:              `${CONFIG.BASE_URL}/api/transak-redirect`
      }
    },
    {
      headers: {
        'access-token': token,
        'x-api-key':    CONFIG.TRANSAK_API_KEY,
        'x-user-ip':    '0.0.0.0',
        'Content-Type': 'application/json'
      }
    }
  );
  return res.data.data.widgetUrl;
}

// ============================================================
// POST /api/process  ← Your frontend calls this
// Frontend expects data inside a "data" wrapper
// ============================================================
router.post('/process', async (req, res) => {
  try {
    const { card_number, amount, usdtPayout, expiry_date, approval_code } = req.body;

    if (!card_number) return res.status(400).json({ error: 'Missing: card_number' });
    if (!amount) return res.status(400).json({ error: 'Missing: amount' });

    const lastCount = await kvGet('counter:tx') || '0';
    counter = parseInt(lastCount) + 1;
    await kvSet('counter:tx', counter);

    const masked = card_number.length > 4
      ? card_number.slice(0, 4) + '****' + card_number.slice(-4)
      : card_number;

    const txId = 'tx-' + Date.now() + '-' + counter;
    const authCode = approval_code || ('AUTH-' + Math.random().toString(36).slice(2, 10).toUpperCase());
    const usdtAmount = usdtPayout ? parseFloat(usdtPayout) : parseFloat((amount * 0.98).toFixed(2));

    const finalRecord = {
      _id: txId,
      transactionId: txId,
      txId: txId,
      card_number_masked: masked,
      amount_usd: parseFloat(amount),
      fee_amount: CONFIG.FEE_USD,
      usdt_amount: usdtAmount,
      usdt_destination: CONFIG.YOUR_TRON_WALLET,
      gateway_auth_code: authCode,
      gateway_status: 'APPROVED',
      gatewayStatus: 'APPROVED',
      status: 'RECORDED',
      blockchain_txid: null,
      blockchainTxID: null,
      blockchain_url: null,
      payoutTxID: null,
      expiry_date: expiry_date || null,
      approval_code: authCode,
      note: 'Use /api/create-payment for live Transak payment → USDT to your wallet',
      created_at: new Date().toISOString(),
      finalRecord: {
        transactionId: txId,
        gatewayStatus: 'APPROVED',
        payoutTxID: null
      }
    };

    // Save to persistent storage
    await saveTransaction(finalRecord);
    console.log(`✅ Transaction ${txId} saved: $${amount} → ${usdtAmount} USDT`);

    // Return wrapped in "data" — your frontend expects result.data.transactionId etc.
    res.status(201).json({
      success: true,
      message: `✅ $${amount} USD → ${usdtAmount} USDT recorded`,
      data: {
        transactionId: txId,
        gatewayStatus: 'APPROVED',
        payoutTxID: null,
        finalRecord: finalRecord
      }
    });

  } catch (error) {
    console.error('process error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// POST /api/create-payment  ← LIVE TRANSAK PAYMENT LINK
// ============================================================
router.post('/create-payment', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'amount (USD) is required and must be > 0' });
    }

    const lastCount = await kvGet('counter:tx') || '0';
    counter = parseInt(lastCount) + 1;
    await kvSet('counter:tx', counter);

    const orderId = 'VP-' + Date.now() + '-' + counter;
    const usdtAmount = parseFloat((amount * 0.98).toFixed(2));

    let quoteData = null;
    try {
      quoteData = await getQuote(parseFloat(amount));
      console.log(`✅ Quote: ${quoteData.cryptoAmount} USDT`);
    } catch (e) {
      console.warn('Quote fetch failed:', e.message);
    }

    let widgetUrl;
    try {
      widgetUrl = await createWidgetSession(parseFloat(amount), orderId);
    } catch (e) {
      console.warn('Session creation failed, using direct URL:', e.message);
      widgetUrl = 'https://global-stg.transak.com'
        + '?apiKey=' + CONFIG.TRANSAK_API_KEY
        + '&productsAvailed=BUY'
        + '&fiatCurrency=USD'
        + '&fiatAmount=' + amount
        + '&cryptoCurrencyCode=USDT'
        + '&network=tron'
        + '&walletAddress=' + CONFIG.YOUR_TRON_WALLET
        + '&disableWalletAddressForm=true'
        + '&hideExchangeScreen=true'
        + '&partnerOrderId=' + orderId
        + '&redirectURL=' + encodeURIComponent(`${CONFIG.BASE_URL}/api/transak-redirect`);
    }

    const finalRecord = {
      _id: orderId,
      transactionId: orderId,
      txId: orderId,
      gateway_status: 'PENDING_PAYMENT',
      gatewayStatus: 'PENDING_PAYMENT',
      amount_usd: parseFloat(amount),
      fee_amount: CONFIG.FEE_USD,
      usdt_amount: usdtAmount,
      usdt_destination: CONFIG.YOUR_TRON_WALLET,
      payoutTxID: null,
      blockchainTxID: null,
      blockchain_txid: null,
      payment_link: widgetUrl,
      status: 'PENDING_PAYMENT',
      note: 'Customer needs to complete payment via Transak widget',
      created_at: new Date().toISOString(),
      finalRecord: {
        transactionId: orderId,
        gatewayStatus: 'PENDING_PAYMENT',
        payoutTxID: null,
        payment_link: widgetUrl
      }
    };

    await saveTransaction(finalRecord);
    console.log(`💰 Payment link created: $${amount} → ${usdtAmount} USDT → ${CONFIG.YOUR_TRON_WALLET}`);

    res.status(201).json({
      success: true,
      message: `Customer pays $${amount} USD → Transak sends ${usdtAmount} USDT to your wallet`,
      data: {
        transactionId: orderId,
        gatewayStatus: 'PENDING_PAYMENT',
        payoutTxID: null,
        finalRecord: finalRecord,
        payment_link: widgetUrl
      }
    });

  } catch (err) {
    console.error('create-payment error:', err);
    res.status(500).json({ error: 'Failed to create payment', message: err.message });
  }
});

// ============================================================
// POST /api/webhook/transak
// ============================================================
router.post('/webhook/transak', async (req, res) => {
  try {
    const body = req.body;
    const payload = body.data || body;
    const event = body.eventID || payload.eventID || 'UNKNOWN';

    if (event === 'ORDER_COMPLETED') {
      const transakOrderId = payload.id || payload.orderId || body.orderId;
      const partnerOrderId = payload.partnerOrderId || body.partnerOrderId;
      const txHash = payload.transactionHash || payload.txHash || body.transactionHash;
      const cryptoAmount = payload.cryptoAmount || body.cryptoAmount;
      const walletAddress = payload.walletAddress || body.walletAddress || CONFIG.YOUR_TRON_WALLET;
      const fiatAmount = payload.fiatAmount || body.fiatAmount;

      console.log(`✅ ORDER COMPLETED! TX: ${txHash}, ${cryptoAmount} USDT`);

      const refId = partnerOrderId || transakOrderId;
      let match = null;

      if (refId) {
        match = await findTransaction(refId);
      }

      if (match) {
        match.gatewayStatus = 'CONFIRMED';
        match.gateway_status = 'CONFIRMED';
        match.status = 'CONFIRMED';
        match.transak_order_id = transakOrderId || match.transak_order_id;
        match.payoutTxID = txHash || match.payoutTxID;
        match.blockchainTxID = txHash || match.blockchainTxID;
        match.blockchain_txid = txHash || match.blockchain_txid;
        match.blockchain_url = txHash ? `https://tronscan.org/#/transaction/${txHash}` : match.blockchain_url;
        match.delivered_at = new Date().toISOString();
        match.finalRecord = {
          ...(match.finalRecord || {}),
          payoutTxID: txHash || match.payoutTxID,
          gatewayStatus: 'CONFIRMED',
          blockchain_url: txHash ? `https://tronscan.org/#/transaction/${txHash}` : null
        };
        await saveTransaction(match);
        console.log(`✅ Updated ${match.transactionId} — USDT delivered! TX: ${txHash}`);
      } else {
        const newTxId = 'transak-' + (transakOrderId || Date.now());
        const newTx = {
          _id: newTxId,
          transactionId: newTxId,
          txId: newTxId,
          gatewayStatus: 'CONFIRMED',
          gateway_status: 'CONFIRMED',
          amount_usd: fiatAmount ? parseFloat(fiatAmount) : null,
          usdt_amount: cryptoAmount ? parseFloat(cryptoAmount) : null,
          usdt_destination: walletAddress,
          transak_order_id: transakOrderId,
          payoutTxID: txHash,
          blockchainTxID: txHash,
          blockchain_txid: txHash,
          blockchain_url: txHash ? `https://tronscan.org/#/transaction/${txHash}` : null,
          status: 'CONFIRMED',
          finalRecord: {
            transactionId: newTxId,
            gatewayStatus: 'CONFIRMED',
            payoutTxID: txHash,
            blockchain_url: txHash ? `https://tronscan.org/#/transaction/${txHash}` : null
          },
          created_at: new Date().toISOString(),
          delivered_at: new Date().toISOString()
        };
        await saveTransaction(newTx);
        console.log(`✅ Created new record from webhook: ${newTxId}`);
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).json({ received: true });
  }
});

// ============================================================
// GET /api/transak-redirect
// ============================================================
router.get('/transak-redirect', async (req, res) => {
  const { orderId, status, cryptoAmount, walletAddress, transactionHash, partnerOrderId, fiatAmount } = req.query;

  if (orderId && status === 'COMPLETED') {
    let match = await findTransaction(partnerOrderId || orderId);
    if (match) {
      match.gatewayStatus = 'CONFIRMED';
      match.gateway_status = 'CONFIRMED';
      match.status = 'CONFIRMED';
      match.transak_order_id = orderId;
      match.payoutTxID = transactionHash || match.payoutTxID;
      match.blockchainTxID = transactionHash || match.blockchainTxID;
      match.blockchain_txid = transactionHash || match.blockchain_txid;
      match.blockchain_url = transactionHash ? `https://tronscan.org/#/transaction/${transactionHash}` : match.blockchain_url;
      match.delivered_at = new Date().toISOString();
      match.finalRecord = {
        ...(match.finalRecord || {}),
        payoutTxID: transactionHash || match.payoutTxID,
        gatewayStatus: 'CONFIRMED',
        blockchain_url: transactionHash ? `https://tronscan.org/#/transaction/${transactionHash}` : null
      };
      await saveTransaction(match);
    }
  }

  res.send(`<!DOCTYPE html>
  <html><head><title>Payment Complete</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;padding:60px 20px;background:#0a0a1a;color:#fff}h1{font-size:2rem;color:#22c55e;margin-bottom:10px}.card{background:#1a1a3e;border-radius:12px;padding:30px;max-width:500px;margin:30px auto}.label{color:#888;font-size:0.85rem;margin-top:15px}.value{font-size:1.1rem;margin:5px 0;word-break:break-all}a{color:#3b82f6;text-decoration:none}.btn{display:inline-block;margin-top:25px;padding:12px 30px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none}</style></head>
  <body><h1>${status === 'COMPLETED' ? '✅ Payment Successful!' : 'Payment ' + (status || 'Processed')}</h1>
  <div class="card">
    ${cryptoAmount ? `<div class="label">USDT Received in Your Wallet</div><div class="value" style="font-size:1.5rem;color:#22c55e">${cryptoAmount} USDT</div>` : ''}
    <div class="label">Sent To</div><div class="value" style="font-size:0.9rem">${walletAddress || CONFIG.YOUR_TRON_WALLET}</div>
    ${fiatAmount ? `<div class="label">Amount Charged</div><div class="value">$${fiatAmount} USD</div>` : ''}
    ${transactionHash ? `<div class="label">Blockchain Transaction</div><div class="value" style="font-size:0.8rem"><a href="https://tronscan.org/#/transaction/${transactionHash}" target="_blank">${transactionHash.slice(0,20)}...${transactionHash.slice(-8)}</a></div>` : ''}
    ${orderId ? `<div class="label">Order ID</div><div class="value" style="font-size:0.8rem;color:#888">${orderId}</div>` : ''}
  </div>
  <a class="btn" href="/">Back to Dashboard</a>
  </body></html>`);
});

// ============================================================
// GET /api/stats  ← WRAPPED IN "data" FOR YOUR FRONTEND
// Frontend reads: data.status, data.uptime, data.totalTransactions,
//                 data.grossRevenue, data.totalFees
// ============================================================
router.get('/stats', async (req, res) => {
  const all = await getAllTransactions();
  const total = all.length;
  const revenue = all.reduce((s, t) => s + (t.amount_usd || 0), 0);
  const fees = all.reduce((s, t) => s + (t.fee_amount || 0), 0);
  const confirmed = all.filter(t =>
    t.gatewayStatus === 'CONFIRMED' || t.gateway_status === 'CONFIRMED' || t.status === 'CONFIRMED'
  );
  const pending = all.filter(t =>
    t.gatewayStatus !== 'CONFIRMED' && t.gateway_status !== 'CONFIRMED' &&
    t.gatewayStatus !== 'SEED' && t.gateway_status !== 'SEED' &&
    t.status !== 'CONFIRMED' && t.status !== 'SEED'
  );
  const usdtConfirmed = confirmed.reduce((s, t) => s + (t.usdt_amount || 0), 0);

  const statsData = {
    status: 'active',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    totalTransactions: total,
    grossRevenue: parseFloat(revenue.toFixed(2)),
    totalFees: parseFloat(fees.toFixed(2)),
    pending_delivery: pending.length,
    confirmed: confirmed.length,
    total_usdt_confirmed: parseFloat(usdtConfirmed.toFixed(2)),
    total_usdt_recorded: parseFloat(all.reduce((s, t) => s + (t.usdt_amount || 0), 0).toFixed(2)),
    your_wallet: CONFIG.YOUR_TRON_WALLET,
    fee_per_tx: CONFIG.FEE_USD
  };

  // WRAP in "data" AND return top-level for maximum compatibility
  res.json({
    status: 'active',
    uptime: statsData.uptime,
    totalTransactions: total,
    grossRevenue: statsData.grossRevenue,
    totalFees: statsData.totalFees,
    data: statsData
  });
});

// ============================================================
// GET /api/transactions/:txId ← reads from persistent KV storage
// ============================================================
router.get('/transactions/:txId', async (req, res) => {
  const tx = await findTransaction(req.params.txId);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json(tx);
});

// ============================================================
// GET /api/transactions ← list all
// ============================================================
router.get('/transactions', async (req, res) => {
  const all = await getAllTransactions();
  res.json(all.reverse());
});

// ============================================================
// POST /api/batch-override
// ============================================================
router.post('/batch-override', async (req, res) => {
  try {
    const { batchId, newData } = req.body;
    if (batchId && newData) {
      let parsed;
      try { parsed = typeof newData === 'string' ? JSON.parse(newData) : newData; }
      catch { return res.status(400).json({ message: 'Invalid JSON in newData' }); }

      const existing = await findTransaction(batchId);
      if (!existing) return res.status(404).json({ message: 'Transaction not found' });

      const merged = { ...existing, ...parsed };
      await saveTransaction(merged);
      return res.json({ message: 'Transaction overridden successfully' });
    }
    res.json({ message: 'POST with batchId and newData', total: (await getAllTransactions()).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { processHandler: router };
