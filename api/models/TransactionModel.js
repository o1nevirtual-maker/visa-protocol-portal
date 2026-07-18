const mongoose = require('mongoose');

// Define the schema structure based on all required fields (Gateway, Blockchain, Amounts)
const TransactionSchema = new mongoose.Schema({
    protocol_code: { type: String, required: true }, // The 4-digit entry code
    card_number_masked: { type: String, index: true }, // Masked card number for quick search
    amount_usd: { type: Number, required: true },   // Gross amount charged to customer
    fee_amount: { type: Number, required: true },   // The system fee taken
    usdt_amount: { type: Number, required: true },   // Net payout sent in USDT (for blockchain)
    gateway_auth_code: { type: String },           // Approval code from Gateway API
    gateway_status: { type: String },               // Status confirmation from Gateway (e.g., APPROVED, DECLINED)
    payout_confirmation: { type: String },           // Confirmation ID/TxID received upon payout execution
    usdt_status_raw: { type: String },              // Raw status read from the blockchain/chain bridge
}, { 
    timestamps: true // Automatically adds createdAt/updatedAt fields - ESSENTIAL for reporting!
});

// Create and export the model interface to Mongo
const TransactionModel = mongoose.model('Transaction', TransactionSchema);
module.exports = TransactionModel;
