const mongoose = require('mongoose');
const TransactionModel = require('../models/TransactionModel');

// --- MOCK FUNCTIONS (Replace with your actual API calls) ---

/**
 * Replaces mockGatewayCall. This MUST call your live payment processor endpoint.
 * @param {string} card_number - Card Number
 * @param {number} amount - USD Amount
 * @param {string} expiry_date - MM/YY Format
 * @param {string} approval_code - Protocol 101.1 Code (or CVV if applicable)
 */
async function processGateway(card_number, amount, expiry_date, approval_code) {
    console.log(`[REAL API] Calling Payment Gateway with Card: ${card_number}, Amount: ${amount}`);
    try {
        // Replace this URL with your actual gateway API endpoint
        const response = await fetch('https://api.paymentgateway.com/authorize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cardNumber: card_number,
                amount: amount,
                expiryDate: expiry_date || 'N/A',
                approvalCode: approval_code || 'N/A'
            })
        });

        if (!response.ok) throw new Error(`Gateway API failure: ${response.statusText}`);
        return response.json();
    } catch (error) {
        console.error("Error calling Gateway:", error);
        throw new Error(`Gateway Authorization Failed: ${error.message}`);
    }
}

/**
 * Replaces mockBlockchainSubmission. This MUST call your actual crypto submission API.
 * @param {number} usdtPayout - The amount determined to be sent to USDT.
 */
async function submitCrypto(usdtPayout) {
    console.log(`[REAL API] Calling Crypto Submission Endpoint for ${usdtPayout} USDT`);
    try {
        // Replace this URL with your actual crypto API endpoint
        const response = await fetch('https://api.cryptoexchange.com/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ payoutAmount: usdtPayout })
        });

        if (!response.ok) throw new Error(`Crypto API failure: ${response.statusText}`);
        return response.json();
    } catch (error) {
        console.error("Error calling Crypto:", error);
        throw new Error(`Blockchain Submission Failed: ${error.message}`);
    }
}

// =====================================================================
// CORE PROCESS HANDLER LOGIC
// =====================================================================

const processHandler = async (req, res) => {
    // --- A. GET /api/stats endpoint logic ---
    if (req.method === 'GET' && req.url.includes('/stats')) {
        try {
            console.log("\n🔍 Fetching historical data from MongoDB...");
            const stats = await mongoose.model('Transaction').aggregate([
                { $group: { _id: null, totalTransactions: { $sum: 1 }, totalRevenue: { $sum: '$amount_usd' }, totalFeesCollected: { $sum: '$fee_amount' } } }
            ]).exec();

            if (stats.length === 0) {
                return res.status(200).json({ message: "No transactions recorded yet." });
            }

            const result = stats[0];
            res.status(200).json({
                totalTransactions: result.totalTransactions,
                grossRevenue: parseFloat(result.totalRevenue.toFixed(2)),
                totalFees: parseFloat(result.totalFeesCollected.toFixed(2))
            });

        } catch (error) {
            console.error("Error fetching stats:", error);
            res.status(500).json({ error: "Failed to retrieve statistics.", details: error.message });
        }
    }

    // --- B. POST /api/process endpoint logic ---
    else if (req.method === 'POST' && req.url.includes('/process')) {
        const { card_number, amount, usdtPayout, expiry_date, approval_code } = req.body;

        if (!card_number || !amount || !usdtPayout) {
            return res.status(400).json({ error: "Missing required fields: card_number, amount, and usdtPayout are mandatory." });
        }

        try {
            // 1. EXECUTE REAL SERVICES in sequence (Gateway first for authorization lock)
            const gatewayResult = await processGateway(card_number, parseFloat(amount), expiry_date || 'N/A', approval_code || 'N/A');

            // If Gateway succeeds, proceed to Crypto submission
            const chainResult = await submitCrypto(parseFloat(usdtPayout));

            // 2. DATABASE PERSISTENCE (Transaction Record)
            const transactionRecord = {
                protocol_code: 'UNKNOWN',
                card_number_masked: card_number,
                amount_usd: parseFloat(amount),
                fee_amount: 1.50, // Using a hardcoded fee amount for the DB record
                usdt_amount: parseFloat(usdtPayout),
                gateway_auth_code: gatewayResult.auth_code || 'N/A',
                gateway_status: gatewayResult.status || 'FAILED',
                payout_confirmation: chainResult.tx_id || 'N/A',
                usdt_status_raw: chainResult.status || 'UNKNOWN',
                card_expiry: expiry_date || 'N/A',
                protocol_approval_code: approval_code || 'N/A'
            };

            const newTx = await mongoose.model('Transaction').create(transactionRecord);
            console.log(`[DB Save] Successfully saved transaction ID: ${newTx._id}`);

            // 3. SUCCESS RESPONSE
            res.status(201).json({
                success: true,
                message: "Transaction processed and recorded successfully!",
                data: {
                    transactionId: newTx._id,
                    gatewayStatus: gatewayResult.status || 'FAILED',
                    payoutTxID: chainResult.tx_id || 'N/A',
                    finalRecord: newTx
                }
            });

        } catch (error) {
            console.error("--- FATAL ERROR DURING TRANSACTION PROCESS:", error);
            res.status(500).json({
                success: false,
                message: "Critical Failure in Transaction Pipeline.",
                details: error.message
            });
        }
    } else {
        res.status(404).json({ error: `No matching endpoint found for method ${req.method} at path ${req.url}` });
    }
};

module.exports = { processHandler };
