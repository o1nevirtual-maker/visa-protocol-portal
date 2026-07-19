const express = require('express');
const router = express.Router();
const axios = require('axios');

const transactions = [];
let counter = 0;
let cachedAccessToken = null;
let tokenExpiry = 0;

// ============================================================
// CONFIG — Your real Transak credentials + your TRON wallet
// ============================================================
const CONFIG = {
  TRANSAK_API_KEY:   process.env.TRANSAK_API_KEY    || 'bf3e985a-a0b1-4458-981b-e3e2c186e78e',
  TRANSAK_SECRET:    process.env.TRANSAK_SECRET     || 'PLSmUce3MrGEhpNwMVZhEQ==',
  YOUR_TRON_WALLET:  process.env.TRON_FROM_ADDRESS  || 'TUc4g5hg47j1sP26J1MRDwWDPX5V4f31uc',
  REFERRER_DOMAIN:   'visa-portal-two.vercel.app',
  BASE_URL:          'https://visa-portal-two.vercel.app',
  USDT_RATE:         0.98,
  FEE_USD:           1.50
};

// ============================================================
// TRANSAK API HELPERS
// ============================================================

/** Get a valid access token from Transak */
async function getTransakToken() {
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
  tokenExpiry = Date.now() + 6 * 24 * 60 * 60 * 1000; // 6 days
  console.log('✅ Transak access token obtained');
  return cachedAccessToken;
}

/** Create a Transak widget session so customer can pay via card */
async function createTransakSession(usdAmount, partnerOrderId) {
  const token = await getTransakToken();

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
// SEED DATA
// ============================================================
for (let i = 1; i <= 3; i++) {
  transactions.push({
    _id: 'seed-' + i,
    amount_usd: 100 * i,
    fee_amount: CONFIG.FEE_USD,
    usdt_amount: parseFloat((100 * i * CONFIG.USDT_RATE).toFixed(2)),
    usdt_destination: CONFIG.YOUR_TRON_WALLET,
    status: 'SEED',
    created_at: Date.now() - i * 60000
  });
}

// ============================================================
// POST /api/process  ← Used by your existing index.html
// Records a USD card payment → USDT owed to your wallet
// ============================================================
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
    const usdtAmount = parseFloat((amount * CONFIG.USDT_RATE).toFixed(2));
    const masked = card_number.length > 4
      ? card_number.slice(0, 4) + '****' + card_number.slice(-4)
      : card_number;

    const txId = 'tx-' + Date.now() + '-' + counter;

    const record = {
      _id: txId,
      card_number_masked: masked,
      amount_usd: parseFloat(amount),
      fee_amount: CONFIG.FEE_USD,
      usdt_amount: usdtAmount,
      usdt_destination: CONFIG.YOUR_TRON_WALLET,
      gateway_auth_code: 'AUTH-' + Math.random().toString(36).slice(2, 10).toUpperCase(),
      gateway_status: 'APPROVED',
      status: 'RECORDED',
      note: 'Use /api/create-payment for live Transak card payment → USDT to your wallet',
      created_at: Date.now()
    };

    transactions.push(record);

    res.status(201).json({
      success: true,
      message: `✅ $${amount} USD → ${usdtAmount} USDT recorded for ${CONFIG.YOUR_TRON_WALLET}`,
      data: record
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// POST /api/create-payment  ← REAL MONEY FLOW
// Creates Transak payment link → customer pays card
// → Transak sends USDT directly to YOUR_TRON_WALLET
// ============================================================
router.post('/create-payment', async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'amount (USD) is required and must be > 0' });
    }

    counter++;
    const orderId = 'VP-' + Date.now() + '-' + counter;
    const usdtAmount = parseFloat((amount * CONFIG.USDT_RATE).toFixed(2));

    // 1. Create internal record
    const record = {
      _id:              orderId,
      amount_usd:       parseFloat(amount),
      fee_amount:       CONFIG.FEE_USD,
      usdt_amount:      usdtAmount,
      usdt_destination: CONFIG.YOUR_TRON_WALLET,
      status:           'PENDING_PAYMENT',
      transak_order_id: null,
      blockchain_txid:  null,
      blockchain_url:   null,
      payment_link:     null,
      created_at:       Date.now()
    };

    // 2. Create Transak payment widget URL
    let widgetUrl;
    try {
      widgetUrl = await createTransakSession(parseFloat(amount), orderId);
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

    record.payment_link = widgetUrl;
    transactions.push(record);

    console.log(`💰 REAL PAYMENT: $${amount} USD → ${usdtAmount} USDT → ${CONFIG.YOUR_TRON_WALLET}`);
    console.log(`🔗 Payment link: ${widgetUrl}`);

    res.status(201).json({
      success: true,
      message: `Customer pays $${amount} USD via card → Transak sends ${usdtAmount} USDT to your wallet`,
      data: {
        order_id:      orderId,
        amount_usd:    parseFloat(amount),
        usdt_expected: usdtAmount,
        your_wallet:   CONFIG.YOUR_TRON_WALLET,
        payment_link:  widgetUrl,
        status:        'PENDING_PAYMENT',
        how_it_works: [
          "1. Send this payment link to your customer",
          "2. Customer pays $${amount} USD via credit/debit card",
          "3. Transak converts USD → USDT on TRON network",
          `4. USDT arrives in YOUR wallet: ${CONFIG.YOUR_TRON_WALLET}`,
          "5. Webhook records the blockchain transaction hash automatically"
        ]
      }
    });

  } catch (err) {
    console.error('create-payment error:', err);
    res.status(500).json({ error: 'Failed to create payment', message: err.message });
  }
});

// ============================================================
// POST /api/webhook/transak
// Transak calls this when USDT is sent to your wallet
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

      console.log(`✅ ORDER_COMPLETED — TX: ${txHash}, ${cryptoAmount} USDT`);

      let match = null;
      const refId = partnerOrderId || transakOrderId;

      if (refId) {
        match = transactions.find(t =>
          t._id === refId ||
          t.processor_ref === refId ||
          t.transak_order_id === transakOrderId
        );
      }

      if (match) {
        const idx = transactions.indexOf(match);
        transactions[idx] = {
          ...match,
          status:           'CONFIRMED',
          transak_order_id: transakOrderId || match.transak_order_id,
          blockchain_txid:  txHash || match.blockchain_txid,
          blockchain_url:   txHash ? `https://tronscan.org/#/transaction/${txHash}` : match.blockchain_url,
          delivered_at:     Date.now()
        };
        console.log(`✅ Updated ${match._id} — USDT delivered!`);
      } else {
        transactions.push({
          _id:              'transak-' + (transakOrderId || Date.now()),
          usdt_amount:      cryptoAmount ? parseFloat(cryptoAmount) : null,
          usdt_destination: walletAddress,
          status:           'CONFIRMED',
          transak_order_id: transakOrderId,
          blockchain_txid:  txHash,
          blockchain_url:   txHash ? `https://tronscan.org/#/transaction/${txHash}` : null,
          notes:            'Auto-recorded from Transak webhook',
          created_at:       Date.now(),
          delivered_at:     Date.now()
        });
        console.log(`✅ Created new record from webhook`);
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
// Customer is redirected here after payment
// ============================================================
router.get('/transak-redirect', (req, res) => {
  const {
    orderId, status, cryptoAmount, walletAddress,
    transactionHash, partnerOrderId, fiatAmount
  } = req.query;

  console.log('🔀 Redirect:', req.query);

  if (orderId && status === 'COMPLETED') {
    const match = transactions.find(t =>
      t._id === partnerOrderId ||
      t._id === orderId ||
      t.processor_ref === partnerOrderId
    );
    if (match) {
      const idx = transactions.indexOf(match);
      transactions[idx] = {
        ...match,
        status:           'CONFIRMED',
        transak_order_id: orderId,
        blockchain_txid:  transactionHash || match.blockchain_txid,
        blockchain_url:   transactionHash
          ? `https://tronscan.org/#/transaction/${transactionHash}`
          : match.blockchain_url,
        delivered_at: Date.now()
      };
    }
  }

  res.send(`<!DOCTYPE html>
  <html>
  <head><title>Payment Complete</title><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;padding:60px 20px;background:#0a0a1a;color:#fff}h1{font-size:2rem;color:#22c55e}.card{background:#1a1a3e;border-radius:12px;padding:30px;max-width:500px;margin:30px auto}.label{color:#888;font-size:0.85rem}.value{font-size:1.1rem;margin:5px 0 15px;word-break:break-all}a{color:#3b82f6;text-decoration:none}.btn{display:inline-block;margin-top:20px;padding:12px 30px;background:#3b82f6;color:#fff;border-radius:8px;text-decoration:none}</style></head>
  <body>
    <h1>${status === 'COMPLETED' ? '✅ Payment Successful!' : 'Payment ' + (status || 'Processed')}</h1>
    <div class="card">
      ${cryptoAmount ? `<div class="label">USDT Received in Your Wallet</div><div class="value">${cryptoAmount} USDT</div>` : ''}
      <div class="label">Sent To</div>
      <div class="value">${walletAddress || CONFIG.YOUR_TRON_WALLET}</div>
      ${transactionHash ? `<div class="label">Blockchain TX</div><div class="value"><a href="https://tronscan.org/#/transaction/${transactionHash}" target="_blank">${transactionHash.slice(0, 24)}...</a></div>` : ''}
      ${fiatAmount ? `<div class="label">Paid</div><div class="value">$${fiatAmount} USD</div>` : ''}
    </div>
    <a class="btn" href="/">Back to Portal</a>
  </body>
  </html>`);
});

// ============================================================
// POST /api/record-payment  (manual record keeping)
// ============================================================
router.post('/record-payment', (req, res) => {
  try {
    const { amount_usd, customer_id, notes } = req.body;
    if (!amount_usd || amount_usd <= 0) {
      return res.status(400).json({ error: 'amount_usd is required' });
    }

    counter++;
    const usdtAmount = parseFloat((amount_usd * CONFIG.USDT_RATE).toFixed(2));

    const record = {
      _id: 'tx-' + Date.now() + '-' + counter,
      amount_usd: parseFloat(amount_usd),
      fee_amount: CONFIG.FEE_USD,
      usdt_amount: usdtAmount,
      usdt_destination: CONFIG.YOUR_TRON_WALLET,
      customer_id: customer_id || null,
      notes: notes || null,
      status: 'PENDING_DELIVERY',
      processor_ref: null,
      blockchain_txid: null,
      blockchain_url: null,
      created_at: Date.now()
    };

    transactions.push(record);
    res.status(201).json({
      success: true,
      message: `$${amount_usd} USD recorded → ${usdtAmount} USDT to ${CONFIG.YOUR_TRON_WALLET}`,
      data: record
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/confirm-delivery (manual blockchain tx record)
// ============================================================
router.post('/confirm-delivery', (req, res) => {
  try {
    const { transaction_id, blockchain_txid, processor_ref } = req.body;
    if (!transaction_id) return res.status(400).json({ error: 'transaction_id is required' });

    const idx = transactions.findIndex(t => t._id === transaction_id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    transactions[idx] = {
      ...transactions[idx],
      status: 'CONFIRMED',
      blockchain_txid: blockchain_txid || transactions[idx].blockchain_txid,
      blockchain_url: blockchain_txid
        ? `https://tronscan.org/#/transaction/${blockchain_txid}`
        : transactions[idx].blockchain_url,
      processor_ref: processor_ref || transactions[idx].processor_ref,
      delivered_at: Date.now()
    };

    res.json({ success: true, message: 'Confirmed', data: transactions[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/stats
// ============================================================
router.get('/stats', (req, res) => {
  const total = transactions.length;
  const revenue = transactions.reduce((s, t) => s + (t.amount_usd || 0), 0);
  const fees = transactions.reduce((s, t) => s + (t.fee_amount || 0), 0);
  const usdt = transactions.reduce((s, t) => s + (t.usdt_amount || 0), 0);
  const confirmed = transactions.filter(t => t.status === 'CONFIRMED');
  const pending = transactions.filter(t => t.status !== 'CONFIRMED' && t.status !== 'SEED');
  const usdtConfirmed = confirmed.reduce((s, t) => s + (t.usdt_amount || 0), 0);

  res.json({
    status: 'active',
    your_wallet: CONFIG.YOUR_TRON_WALLET,
    usdt_rate: CONFIG.USDT_RATE,
    fee_per_tx: CONFIG.FEE_USD,
    total_transactions: total,
    pending_delivery: pending.length,
    confirmed: confirmed.length,
    gross_revenue_usd: parseFloat(revenue.toFixed(2)),
    total_fees_usd: parseFloat(fees.toFixed(2)),
    total_usdt_recorded: parseFloat(usdt.toFixed(2)),
    total_usdt_confirmed: parseFloat(usdtConfirmed.toFixed(2))
  });
});

// ============================================================
// GET /api/transactions/:id
// ============================================================
router.get('/transactions/:id', (req, res) => {
  const tx = transactions.find(t =>
    t._id === req.params.id ||
    t.processor_ref === req.params.id ||
    t.blockchain_txid === req.params.id
  );
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  res.json(tx);
});

// ============================================================
// POST /api/batch-override
// ============================================================
router.post('/batch-override', (req, res) => {
  try {
    const { batch_id, new_data, auto_run, mark_delivered, blockchain_txid } = req.body;

    if (mark_delivered) {
      let count = 0;
      const fallback = 'manual-' + Date.now();
      transactions.forEach((t, i) => {
        if (t.status !== 'CONFIRMED') {
          transactions[i] = {
            ...t,
            status: 'CONFIRMED',
            blockchain_txid: blockchain_txid || t.blockchain_txid || fallback,
            blockchain_url: (blockchain_txid || t.blockchain_txid)
              ? `https://tronscan.org/#/transaction/${blockchain_txid || t.blockchain_txid}`
              : null,
            delivered_at: Date.now()
          };
          count++;
        }
      });
      return res.json({ success: true, message: `${count} marked CONFIRMED` });
    }

    if (auto_run) {
      const data = typeof new_data === 'string' ? JSON.parse(new_data) : (new_data || {});
      transactions.forEach((t, i) => { transactions[i] = { ...t, ...data }; });
      return res.json({ message: `All ${transactions.length} updated` });
    }

    if (batch_id && new_data) {
      const idx = transactions.findIndex(t => t._id === batch_id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      const data = typeof new_data === 'string' ? JSON.parse(new_data) : new_data;
      transactions[idx] = { ...transactions[idx], ...data };
      return res.json({ message: 'Updated', transaction: transactions[idx] });
    }

    res.json({
      total: transactions.length,
      confirmed: transactions.filter(t => t.status === 'CONFIRMED').length,
      pending: transactions.filter(t => t.status !== 'CONFIRMED').length,
      your_wallet: CONFIG.YOUR_TRON_WALLET
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { processHandler: router };
