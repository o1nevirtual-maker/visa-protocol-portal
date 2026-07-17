const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// --- ENUMERATIONS FOR DATA INTEGRITY ---
const StatusEnum = {
    CARD_STATUS: ['SUCCESS', 'DECLINED', 'ERROR'],
    PAYOUT_STATUS: ['PENDING', 'COMPLETED', 'FAILED']
};


const TransactionSchema = new Schema({
    // === Proof 1: Submission Data (What the Merchant Provided) ===
    protocol_code: { type: String, required: true, index: true }, // The key code (The manual input proof)
    card_number_masked: { type: String, required: true },
    amount_usd: { type: Number, required: true },
    fee_amount: { type: Number, default: 0.00 },

    // === Proof 2: Gateway Validation Layer (The Virtual Promise) ===
    gateway_validation: { 
        isAuthorized: { type: Boolean, default: false },
        mockReservationId: { type: String }, // Mock reservation ID if using mock mode
        // This captures the *result* of our simulation/validation step.
        validatedStatus: { 
            type: String, 
            enum: StatusEnum.CARD_STATUS, 
            default: 'ERROR' 
        }
    },

    // === Proof 3: Blockchain Payout (The Immutable Record) ===
    payout_execution: {
        usdt_amount: { type: String, required: true }, // The calculated payout amount
        status: { type: String, enum: StatusEnum.PAYOUT_STATUS, default: 'PENDING' },
        blockchain_tx_hash: { type: String, unique: true, sparse: true }, // Unique hash on TRON
    },

    // === OVERALL STATE & AUDIT ==============================
    overall_status: { 
        type: String, 
        enum: ['COMPLETE', 'PENDING_FUND_SETTLEMENT', 'FAILED'], 
        default: 'PENDING_FUND_SETTLEMENT' 
    },
    system_reference_id: { type: String, unique: true, sparse: true }, // Our system's ID
    createdAt: { type: Date, default: Date.now },

}, { timestamps: true });

// Pre-save hook to automatically set initial status when a transaction is created
TransactionSchema.pre('save', function(next) {
    if (!this.overall_status) {
        this.overall_status = 'PENDING_FUND_SETTLEMENT';
    }
    next();
});


module.exports = mongoose.model('Transaction', TransactionSchema);
