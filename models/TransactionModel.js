const getTransactionModel = () => {
  try {
    const mongoose = require('mongoose');

    // Check if model already exists (prevents OverwriteModelError)
    if (mongoose.models.Transaction) {
      return mongoose.models.Transaction;
    }

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

    return mongoose.model('Transaction', TransactionSchema);
  } catch (error) {
    console.warn("TransactionModel failed to load:", error.message);
    return null;
  }
};

module.exports = getTransactionModel;
