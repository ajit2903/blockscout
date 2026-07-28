const { JsonRpcProvider, Wallet, parseEther } = require("ethers");

// Configuration
const PROVIDER_URL = process.env.PROVIDER_URL; // Set in environment variables
const PRIVATE_KEY = process.env.PRIVATE_KEY; // Set in environment variables
const RECIPIENT_ADDRESS = "0x06EE840642a33367ee59fCA237F270d5119d1356";
const AMOUNT_IN_ETHER = "64"; // 64 ETH

if (!PROVIDER_URL || !PRIVATE_KEY) {
    console.error("Error: PROVIDER_URL and PRIVATE_KEY must be set as environment variables.");
    process.exit(1);
}

async function main() {
    try {
        // Connect to the Ethereum network
        const provider = new JsonRpcProvider(PROVIDER_URL);
        console.log("Connected to the Ethereum network");

        // Create a wallet instance
        const wallet = new Wallet(PRIVATE_KEY, provider);
        console.log("Wallet connected:", wallet.address);

        // Transaction details
        const tx = {
            to: RECIPIENT_ADDRESS,
            value: parseEther(AMOUNT_IN_ETHER), // Convert ETH to Wei
        };

        // Send the transaction
        console.log(`Sending ${AMOUNT_IN_ETHER} ETH to ${RECIPIENT_ADDRESS}...`);
        const transactionResponse = await wallet.sendTransaction(tx);
        console.log("Transaction sent! Hash:", transactionResponse.hash);

        // Wait for the transaction to be mined
        const receipt = await transactionResponse.wait();
        console.log("Transaction confirmed!");
        console.log("Block Number:", receipt.blockNumber);
        console.log("Transaction Hash:", receipt.hash);
    } catch (error) {
        console.error("Error during transaction:", error);
    }
}

// Execute the script
main();
2. PULL_REQUEST_TEMPLATE.md — in the example block only (leave everything else in the file the same), replace this section:

const { ethers } = require("ethers");

// Configuration
const PROVIDER_URL = "YOUR_PROVIDER_URL"; // e.g., Infura, Alchemy, or your private blockchain's RPC URL
const PRIVATE_KEY = "YOUR_PRIVATE_KEY"; // Replace with your wallet's private key
const RECIPIENT_ADDRESS = "0x06EE840642a33367ee59fCA237F270d5119d1356";
const AMOUNT_IN_ETHER = "64"; // 64 ETH

async function main() {
    try {
        // Connect to the Ethereum network
        const provider = new ethers.JsonRpcProvider(PROVIDER_URL);
        console.log("Connected to the Ethereum network");

        // Create a wallet instance
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
        console.log("Wallet connected:", wallet.address);

        // Transaction details
        const tx = {
            to: RECIPIENT_ADDRESS,
            value: ethers.parseEther(AMOUNT_IN_ETHER), // Convert ETH to Wei
        };

        // Send the transaction
        console.log(`Sending ${AMOUNT_IN_ETHER} ETH to ${RECIPIENT_ADDRESS}...`);
        const transactionResponse = await wallet.sendTransaction(tx);
        console.log("Transaction sent! Hash:", transactionResponse.hash);

        // Wait for the transaction to be mined
        const receipt = await transactionResponse.wait();
        console.log("Transaction confirmed!");
        console.log("Block Number:", receipt.blockNumber);
        console.log("Transaction Hash:", receipt.hash);
    } catch (error) {
        console.error("Error during transaction:", error);
    }
}

// Execute the script
main();
