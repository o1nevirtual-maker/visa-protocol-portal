// PASTE THE ENTIRE CONTENT OF THIS FILE HERE
const mongoose = require('mongoose');
const TransactionModel = require('../models/TransactionModel'); 
// ... (Keep mockGatewayCall and mockBlockchainSubmission as they are) ...

/**
 * Core API Handler Wrapper that routes traffic for /stats and /process endpoint logic.
 */
const processHandler = async (req, res) => {
    // --- A. GET /api/stats endpoint logic ---
    if (req.method === 'GET' &amp;&amp; req.url.includes('/stats')) {
        try {
            console.log("\n🔍 Fetching historical data from MongoDB...");

            // CORRECTED: Simplified aggregation pipe syntax to resolve SyntaxError
            const stats = await mongoose.model('Transaction').aggregate([
                { 
                    $group: { 
                        _id: null, 
                        totalTransactions: { $sum: 1 }, 
                        totalRevenue: { $sum: '$amount_usd' }, 
                        totalFeesCollected: { $sum: '$fee_amount' } 
                    } 
                }
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
    else if (req.method === 'POST' &amp;&amp; req.url.includes('/process')) {
        const { card_number, amount, usdtPayout } = req.body;

        if (!card_number || !amount || !usdtPayout) {
            // Log the failure explicitly for debugging:
            console.warn("POST /api/process received empty or missing required fields.");
            return res.status(400).json({ error: "Missing required fields: card_number, amount, and usdtPayout are mandatory." });
        }

        try {
            // 1. GATEWAY AUTHORIZATION &amp;amp;amp;BLOCKCHAIN SUBMISSION
            const gatewayResult = await mockGatewayCall(card_number, amount);
            const chainResult = await mockBlockchainSubmission(parseFloat(usdtPayout));

            // 2. DATABASE PERSISTENCE
            const transactionRecord = {
                protocol_code: 'UNKNOWN',
                card_number_masked: card_number,
                amount_usd: parseFloat(amount),
                fee_amount: 1.50, // Hardcoded fee for now
                usdt_amount: parseFloat(usdtPayout),
                gateway_auth_code: gatewayResult.auth_code,
                gateway_status: gatewayResult.status,
                payout_confirmation: chainResult.tx_id, 
                usdt_status_raw: chainResult.status,
            };

            const newTx = await mongoose.model('Transaction').create(transactionRecord); 
            console.log(`[DB Save] Successfully saved transaction ID: ${newTx._id}`);

            // 3. SUCCESS RESPONSE
            res.status(201).json({
                success: true,
                message: "Transaction processed and recorded successfully!",
                data: { 
                    transactionId: newTx._id, 
                    gatewayStatus: gatewayResult.status,
                    payoutTxID: chainResult.tx_id,
                    finalRecord: newTx
                }
            });

        } catch (error) {
            // IMPROVED LOGGING TO CATCH THE FAILURE POINT ACCURATELY
            console.error("--- FATAL ERROR DURING TRANSACTION PROCESS ---", error);
            res.status(500).json({ 
                success: false, 
                message: "Internal Server Error during transaction pipeline.", 
                details: error.message 
            });
        }
    } else {
         // Default response for any other endpoint hit on the /api prefix
         res.status(404).json({ error: `No matching endpoint found for method ${req.method} at path ${req.url}` });
    }
};

module.exports = { processHandler };
