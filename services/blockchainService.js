// services/blockchainService.js
const TronWeb = require('tronweb');

// Initialize client with credentials passed in the main file or loaded here
// NOTE: For simplicity, we re-initialize within this service for now, 
// but ideally, the connection object itself should be passed around.
let tronWebClient;

/**
 * Initializes the TronWeb client using environment variables.
 */
const initializeTronWeb = (apiKey, privateKey) => {
    if (!tronWebClient || !process.env.TRONGRID_API_KEY) {
        tronWebClient = new TronWeb({
            fullHost: 'https://api.trongrid.io',
            headers: { 'TRON-PRO-API-KEY': apiKey },
            privateKey: privateKey
        });
    }
    return tronWebClient;
};

/**
 * Handles sending the USDT payout transaction.
 * @param {string} amount - The precise USD value to send as string.
 * @returns {Promise<{txId: string, status: 'CONFIRMED'|'PENDING', txHash: string}>}
 */
async function sendUsdtPayout(amount) {
    const tronWeb = await initializeTronWeb(process.env.TRONGRID_API_KEY, process.env.TRON_PRIVATE_KEY);
    const contractAddress = process.env.TRON_USDT_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // Use env var for flexibility

    try {
        const amountInSun = Math.floor(parseFloat(amount) * 1_000_000);
        const contract = await tronWeb.contract().at(contractAddress);

        // Check balance (as you implemented before)
        const balance = await contract.balanceOf(process.env.TRON_FROM_ADDRESS).call();
        if (parseFloat(balance) < amount) {
            throw new Error(`Insufficient balance on TRON network. Have ${parseFloat(balance)}, need ${amount}`);
        }

        // 1. Send Transaction
        const txId = await contract.transfer(process.env.TRON_DESTINATION_ADDRESS, amountInSun).send();
        await new Promise(r => setTimeout(r, 5000)); // Wait for initial confirmation buffer

        // 2. Fetch Info & Retry Loop (IMPLEMENTING ROBUSTNESS HERE)
        let info = await tronWeb.trx.getTransactionInfo(txId);
        let status = info?.receipt?.result === 'SUCCESS' ? 'CONFIRMED' : 'PENDING';

        // *** TODO: Implement the RETRY LOOP here for full production robustness! *** 

        return { txId, status, txHash: 'N/A_To_be_updated_by_manual_scan' };
    } catch (error) {
        console.error("[Blockchain Service] Failed to execute payout:", error);
        throw new Error(`Payout failure on TRON chain: ${error.message}`);
    }
}

module.exports = {
    sendUsdtPayout,
};
