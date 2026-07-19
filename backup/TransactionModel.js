const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  protocol_code: { type: String, default: 'UNKNOWN' },
  card_number_masked: { type: String, required: true },
  amount_usd: { type: Number, required: true },
  fee_amount: { type: Number, default: 1.50 },
  usdt_amount: { type: Number, required: true },
  gateway_auth_code: { type: String },
  gateway_status: { type: String, default: 'PENDING' },
  payout_confirmation: { type: String },
  usdt_status_raw: { type: String, default: 'INITIATED' }
}, { timestamps: true });

module.exports = mongoose.model('Transaction', TransactionSchema);
