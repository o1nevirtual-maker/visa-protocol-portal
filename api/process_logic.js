// PASTE THE ENTIRE CONTENT OF THIS FILE HERE
const mongoose = require('mongoose');
const TransactionModel = require('../models/TransactionModel'); 

// --- MOCK FUNCTIONS (Replace with your actual API calls) ---

async function processGateway(card_number, amount, expiry_date, approval_code) {
    console.log(`[REAL API] Calling Payment Gateway with Card: ${card_number}, Amount: ${amount}`);
    try {
        // *** &lt;&lt;&lt; PASTE YOUR ACTUAL GATEWAY API CALL HERE &gt;&gt;&gt; ***
        const response = await fetch('YOUR_LIVE_GATEWAY_API_ENDPOINT', { 
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                cardNumber: card_number, 
                amount: amount, 
                expiryDate: expiry_date || 'N/A',
                approvalCode: approval_code || 'N/A'
            })
        });

        if (!response.ok) {
             // Try to parse error body if available
            const errorBody = await response.text();
            throw new Error(`Gateway API failure (${response.status}): ${errorBody ? errorBody : response.statusText}`);
        }
        return await response.json(); // Await and return parsed JSON data
    } catch (error) {
        console.error("Error calling Gateway:", error);
        // Throw an object describing the failure for client consumption
        throw { step: 'GATEWAY_FAIL', message: error.message, detail: error };
    }
}

async function submitCrypto(usdtPayout) {
    console.log(`[REAL API] Calling Crypto Submission Endpoint for ${usdtPayout} USDT`);
    try {
        // *** &lt;&lt;&lt; PASTE YOUR ACTUAL CRYPTO SUBMISSION API CALL HERE &gt;&gt;&gt; ***
        const response = await fetch('YOUR_LIVE_CRYPTO_API_ENDPOINT', { 
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ payoutAmount: usdtPayout })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Crypto API failure (${response.status}): ${errorBody ? errorBody : response.statusText}`);
        }
        return await response.json(); 
    } catch (error) {
        console.error("Error calling Crypto:", error);
        // Throw an object describing the failure for client consumption
        throw { step: 'CRYPTO_FAIL', message: error.message, detail: error };
    }
}

/**
 * Core API Handler Wrapper that routes traffic for /stats and /process endpoint logic.
*/
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
            // 1. GATEWAY AUTHORIZATION &amp;amp; BLOCKCHAIN SUBMISSION
            const gatewayResult = await processGateway(card_number, parseFloat(amount), expiry_date || 'N/A', approval_code || 'N/A');
            const chainResult = await submitCrypto(parseFloat(usdtPayout));

            // 2. DATABASE PERSISTENCE
            const transactionRecord = {
                protocol_code: 'UNKNOWN',
                card_number_masked: card_number,
                amount_usd: parseFloat(amount),
                fee_amount: 1.50, // Placeholder fee saved here
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
            // Comprehensive error handling: Determine if the error came from a specific service failure or general Mongo error
            let detailedError = "Unknown critical error.";
            if (typeof error === 'object' && error.step) {
                detailedError = `Service Failure (${error.step}): ${error.message}. Details: ${JSON.stringify(error.detail)}`;
            } else {
                // Generic server/DB error
                detailedError = `Internal Server Error: ${error.message || "See stack trace for details."}`;
            }

            console.error("--- TRANSACTION FAILURE DIAGNOSTICS ---", detailedError);
            res.status(500).json({ 
                success: false, 
                message: "Transaction pipeline failed.", 
                details: { errorSource: detailedError }
            });
        }
    } else {
        res.status(404).json({ error: `No matching endpoint found for method ${req.method} at path ${req.url}` });
    }
};


module.exports = { processHandler };

// END OF FILE
