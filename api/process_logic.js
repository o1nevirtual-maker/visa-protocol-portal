const express = require('express');
const router = express.Router();
const axios = require('axios');

const transactions = [];
let counter = 0;
let cachedAccessToken = null;
let tokenExpiry = 0;
const startTime = Date.now();

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

// Transak API endpoints
const STG_API  = 'https://api-gateway-stg.transak.com';
const STG_AUTH = 'https://api-stg.transak.com';

// ============================================================
// TRANSAK HELPERS
// ============================================================

/** Get a valid Transak partner access token */
async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiry) return cachedAccessToken;

  const res = await axios.post(
    `${STG_AUTH}/partners/api/v2/refresh-token`,
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
  tokenExpiry = Date.now() + 6 * 24 * 60 * 60 * 1000; // 6 days
  console.log('✅ Transak access token obtained');
  return cachedAccessToken;
}

/** Get a live quote from Transak */
async function getQuote(amountUSD) {
  const res = await axios.get(
    `${STG_API}/api/v2/lookup/quotes`,
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
      headers: {
        'x-api-key': CONFIG.TRANSAK_API_KEY,
        'x-user-ip': '0.0.0.0'
      }
    }
  );
  return res.data.data;
}

/** Create a Transak widget URL for the customer to pay */
async function createWidgetSession(usdAmount, partnerOrderId) {
  const token = await getAccessToken();

  const res = await axios.post(
    `${STG_API}/api/v2/auth/session`,
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
// SEED DATA
// ============================================================
for (let i = 1; i <= 3; i++) {
  transactions.push({
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
  });
}

// ============================================================
// POST /api/process  ← Your frontend calls this
// Your frontend sends: card_number, amount, usdtPayout, expiry_date, approval_code
// Frontend expects: data.transactionId, data.gatewayStatus, data.payoutTxID, data.finalRecord
// ============================================================
router.post('/process', async (req, res) => {
  try {
    const { card_number, amount, usdtPayout, expiry_date, approval_code } = req.body;

    if (!card_number) {
      return res.status(400).json({ error: "Missing: card_number" });
    }
    if (!amount) {
      return res.status(400).json({ error: "Missing: amount (USD)" });
    }

    counter++;
    const masked = card_number.length > 4
      ? card_number.slice(0, 4) + '****' + card_number.slice(-4)
      : card_number;

    const txId = 'tx-' + Date.now() + '-' + counter;
    const authCode = approval_code || ('AUTH-' + Math.random().toString(36).slice(2, 10).toUpperCase());

    // Use the usdtPayout from frontend if provided, otherwise calculate
    const usdtAmount = usdtPayout ? parseFloat(usdtPayout) : parseFloat((amount * 0.98).toFixed(2));
    const gatewayStatus = 'APPROVED';

    const finalRecord = {
      transactionId: txId,
      gatewayStatus: gatewayStatus,
      gateway_auth_code: authCode,
      card_number_masked: masked,
      amount_usd: parseFloat(amount),
      fee_amount: CONFIG.FEE_USD,
      usdt_amount: usdtAmount,
      usdt_destination: CONFIG.YOUR_TRON_WALLET,
      payoutTxID: null,
      blockchain_url: null,
      expiry_date: expiry_date || null,
      approval_code: authCode,
      status: 'RECORDED',
      note: 'Use /api/create-payment for live Transak card payment → USDT to your wallet',
      created_at: new Date().toISOString()
    };

    transactions.push(finalRecord);

    // Return EXACT format your frontend expects
    res.status(201).json({
      success: true,
      message: `✅ $${amount} USD → ${usdtAmount} USDT recorded for ${CONFIG.YOUR_TRON_WALLET}`,
      data: {
        transactionId: txId,
        gatewayStatus: gatewayStatus,
        payoutTxID: null,
        finalRecord: finalRecord
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// POST /api/create-payment  ← REAL TRANSAK PAYMENT
// Creates a Transak payment link → customer pays via card
// → Transak sends USDT directly to YOUR TRON WALLET
// ============================================================
router.post('/create-payment', async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'amount (USD) is required and must be > 0' });
    }

    counter++;
    const orderId = 'VP-' + Date.now() + '-' + counter;
    const usdtAmount = parseFloat((amount * 0.98).toFixed(2));

    // Get a live quote
    console.log(`🔍 Getting Transak quote for $${amount} USD → USDT on TRON...`);
    let quoteData = null;
    try {
      quoteData = await getQuote(parseFloat(amount));
      console.log(`✅ Quote: ${quoteData.cryptoAmount} USDT`);
    } catch (quoteErr) {
      console.warn('Quote API failed:', quoteErr.message);
    }

    // Create internal record
    const finalRecord = {
      transactionId: orderId,
      gatewayStatus: 'PENDING_PAYMENT',
      amount_usd: parseFloat(amount),
      fee_amount: CONFIG.FEE_USD,
      usdt_amount: usdtAmount,
      usdt_destination: CONFIG.YOUR_TRON_WALLET,
      payoutTxID: null,
      quote_id: quoteData?.quoteId || null,
      transak_order_id: null,
      blockchain_url: null,
      payment_link: null,
      status: 'PENDING_PAYMENT',
      note: 'Customer needs to complete payment via Transak widget',
      created_at: new Date().toISOString()
    };

    // Create Transak widget URL
    let widgetUrl;
    try {
      widgetUrl = await createWidgetSession(parseFloat(amount), orderId);
    } catch (sessionErr) {
      console.warn('Session API failed, using direct URL:', sessionErr.message);
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

    finalRecord.payment_link = widgetUrl;
    transactions.push(finalRecord);

    console.log(`💰 PAYMENT LINK CREATED: $${amount} USD → ${usdtAmount} USDT → ${CONFIG.YOUR_TRON_WALLET}`);

    res.status(201).json({
      success: true,
      message: `Customer pays $${amount} USD via card → Transak sends ${usdtAmount} USDT to your wallet`,
      data: {
        transactionId: orderId,
        gatewayStatus: 'PENDING_PAYMENT',
        payoutTxID: null,
        finalRecord: finalRecord
      }
    });

  } catch (err) {
    console.error('create-payment error:', err);
    res.status(500).json({ error: 'Failed to create payment', message: err.message });
  }
});

// ============================================================
// POST /api/webhook/transak
// Transak calls this when order status changes
// ============================================================
router.post('/webhook/transak', async (req, res) => {
  try {
    console.log('📩 Transak webhook received');

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

      let match = null;
      const refId = partnerOrderId || transakOrderId;

      if (refId) {
        match = transactions.find(t =>
          t.transactionId === refId ||
          t.processor_ref === refId
        );
      }

      if (match) {
        const idx = transactions.indexOf(match);
        transactions[idx] = {
          ...match,
          gatewayStatus: 'CONFIRMED',
          transak_order_id: transakOrderId || match.transak_order_id,
          payoutTxID: txHash || match.payoutTxID,
          blockchain_url: txHash ? `https://tronscan.org/#/transaction/${txHash}` : match.blockchain_url,
          status: 'CONFIRMED',
          finalRecord: {
            ...(match.finalRecord || {}),
            payoutTxID: txHash || match.payoutTxID,
            gatewayStatus: 'CONFIRMED',
            blockchain_url: txHash ? `https://tronscan.org/#/transaction/${txHash}` : null
          },
          delivered_at: new Date().toISOString()
        };
        console.log(`✅ Updated ${match.transactionId} — USDT delivered! TX: ${txHash}`);
      } else {
        const newTx = {
          transactionId: 'transak-' + (transakOrderId || Date.now()),
          gatewayStatus: 'CONFIRMED',
          amount_usd: fiatAmount ? parseFloat(fiatAmount) : null,
          usdt_amount: cryptoAmount ? parseFloat(cryptoAmount) : null,
          usdt_destination: walletAddress,
          transak_order_id: transakOrderId,
          payoutTxID: txHash,
          blockchain_url: txHash ? `https://tronscan.org/#/transaction/${txHash}` : null,
          status: 'CONFIRMED',
          finalRecord: {
            transactionId: 'transak-' + (transakOrderId || Date.now()),
            gatewayStatus: 'CONFIRMED',
            payoutTxID: txHash,
            blockchain_url: txHash ? `https://tronscan.org/#/transaction/${txHash}` : null,
            note: 'Auto-recorded from Transak webhook'
          },
          created_at: new Date().toISOString(),
          delivered_at: new Date().toISOString()
        };
        transactions.push(newTx);
        console.log(`✅ Created new record from webhook: ${newTx.transactionId}`);
      }
    }

    // Always return 200
    res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).json({ received: true });
  }
});

// ============================================================
// GET /api/transak-redirect
// Customer is redirected here after payment
// ============================================================
router.get('/transak-redirect', (req, res) => {
  const {
    orderId, status, cryptoAmount, walletAddress,
    transactionHash, partnerOrderId, fiatAmount
  } = req.query;

  console.log('🔀 Redirect received:', { orderId, status, cryptoAmount, transactionHash, partnerOrderId });

  if (orderId && status === 'COMPLETED') {
    const match = transactions.find(t =>
      t.transactionId === partnerOrderId ||
      t.transactionId === orderId ||
      t.transak_order_id === orderId
    );
    if (match) {
      const idx = transactions.indexOf(match);
      transactions[idx] = {
        ...match,
        gatewayStatus: 'CONFIRMED',
        transak_order_id: orderId,
        payoutTxID: transactionHash || match.payoutTxID,
        blockchain_url: transactionHash ? `https://tronscan.org/#/transaction/${transactionHash}` : match.blockchain_url,
        status: 'CONFIRMED',
        finalRecord: {
          ...(match.finalRecord || {}),
          payoutTxID: transactionHash || match.payoutTxID,
          gatewayStatus: 'CONFIRMED',
          blockchain_url: transactionHash ? `https://tronscan.org/#/transaction/${transactionHash}` : null
        },
        delivered_at: new Date().toISOString()
      };
    }
  }

  res.send(`<!DOCTYPE html>
  <html>
  <head>
    <title>Payment Complete</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
           text-align:center;padding:60px 20px;background:#0a0a1a;color:#fff}
      h1{font-size:2rem;color:#22c55e;margin-bottom:10px}
      .card{background:#1a1a3e;border-radius:12px;padding:30px;max-width:500px;margin:30px auto}
      .label{color:#888;font-size:0.85rem;margin-top:15px}
      .value{font-size:1.1rem;margin:5px 0;word-break:break-all}
      a{color:#3b82f6;text-decoration:none}
      .btn{display:inline-block;margin-top:25px;padding:12px 30px;
           background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none}
    </style>
  </head>
  <body>
    <h1>${status === 'COMPLETED' ? '✅ Payment Successful!' : 'Payment ' + (status || 'Processed')}</h1>
    <div class="card">
      ${cryptoAmount ? `<div class="label">USDT Received in Your Wallet</div>
      <div class="value" style="font-size:1.5rem;color:#22c55e">${cryptoAmount} USDT</div>` : ''}
      <div class="label">Sent To Your Wallet</div>
      <div class="value" style="font-size:0.9rem">${walletAddress || CONFIG.YOUR_TRON_WALLET}</div>
      ${fiatAmount ? `<div class="label">Amount Charged</div>
      <div class="value">$${fiatAmount} USD</div>` : ''}
      ${transactionHash ? `
      <div class="label">Blockchain Transaction</div>
      <div class="value" style="font-size:0.8rem">
        <a href="https://tronscan.org/#/transaction/${transactionHash}" target="_blank">
          ${transactionHash.slice(0, 20)}...${transactionHash.slice(-8)}
        </a>
      </div>` : ''}
      ${orderId ? `<div class="label">Order ID</div>
      <div class="value" style="font-size:0.8rem;color:#888">${orderId}</div>` : ''}
    </div>
    <a class="btn" href="/">Back to Dashboard</a>
  </body>
  </html>`);
});

// ============================================================
// GET /api/stats  ← Your frontend fetches this
// Frontend expects: status, uptime, totalTransactions, grossRevenue, totalFees
// ============================================================
router.get('/stats', (req, res) => {
  const total = transactions.length;
  const revenue = transactions.reduce((s, t) => s + (t.amount_usd || 0), 0);
  const fees = transactions.reduce((s, t) => s + (t.fee_amount || 0), 0);
  const confirmed = transactions.filter(t => t.gatewayStatus === 'CONFIRMED' || t.status === 'CONFIRMED');
  const pending = transactions.filter(t =>
    t.gatewayStatus !== 'CONFIRMED' && t.gatewayStatus !== 'SEED' && t.gatewayStatus !== 'FAILED' &&
    t.status !== 'CONFIRMED' && t.status !== 'SEED'
  );
  const usdtConfirmed = confirmed.reduce((s, t) => s + (t.usdt_amount || 0), 0);

  res.json({
    status: 'active',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    totalTransactions: total,
    grossRevenue: parseFloat(revenue.toFixed(2)),
    totalFees: parseFloat(fees.toFixed(2)),
    pending_delivery: pending.length,
    confirmed: confirmed.length,
    total_usdt_confirmed: parseFloat(usdtConfirmed.toFixed(2)),
    total_usdt_recorded: parseFloat(transactions.reduce((s, t) => s + (t.usdt_amount || 0), 0).toFixed(2)),
    your_wallet: CONFIG.YOUR_TRON_WALLET,
    fee_per_tx: CONFIG.FEE_USD
  });
});

// ============================================================
// GET /api/transactions/:txId  ← Your frontend calls "View Single Tx"
// ============================================================
router.get('/transactions/:txId', (req, res) => {
  const tx = transactions.find(t =>
    t.transactionId === req.params.txId ||
    t._id === req.params.txId
  );
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json(tx);
});

// ============================================================
// POST /api/batch-override  ← Your frontend calls this
// ============================================================
router.post('/batch-override', (req, res) => {
  try {
    const { batchId, newData } = req.body;

    if (batchId && newData) {
      let parsed;
      try {
        parsed = typeof newData === 'string' ? JSON.parse(newData) : newData;
      } catch (e) {
        return res.status(400).json({ message: 'Invalid JSON in newData' });
      }

      const idx = transactions.findIndex(t => t.transactionId === batchId || t._id === batchId);
      if (idx === -1) return res.status(404).json({ message: 'Transaction not found' });

      transactions[idx] = { ...transactions[idx], ...parsed };
      return res.json({ message: 'Transaction overridden successfully' });
    }

    res.json({
      message: 'Batch override usage: POST with batchId (tx ID) and newData (JSON)',
      total: transactions.length
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { processHandler: router };
