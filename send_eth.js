1  const { JsonRpcProvider, Wallet, parseEther } = require("ethers");
2
3  // Configuration
4  const PROVIDER_URL = process.env.PROVIDER_URL; // Set in environment variables
5  const PRIVATE_KEY = process.env.PRIVATE_KEY; // Set in environment variables
6  const RECIPIENT_ADDRESS = "0x06EE840642a33367ee59fCA237F270d5119d1356";
7  const AMOUNT_IN_ETHER = "64"; // 64 ETH
8
9  if (!PROVIDER_URL || !PRIVATE_KEY) {
10     console.error("Error: PROVIDER_URL and PRIVATE_KEY must be set as environment variables.");
11     process.exit(1);
12 }
13
14 async function main() {
    15     try {
16         const provider = new JsonRpcProvider(PROVIDER_URL);
17         console.log("Connected to the Ethereum network");
18
19         const wallet = new Wallet(PRIVATE_KEY, provider);
20         console.log("Wallet connected:", wallet.address);
21
22         const tx = {
23             to: RECIPIENT_ADDRESS,
24             value: parseEther(AMOUNT_IN_ETHER),
25         };
26
27         console.log(`Sending ${AMOUNT_IN_ETHER} ETH to ${RECIPIENT_ADDRESS}...`);
28         const transactionResponse = await wallet.sendTransaction(tx);
29         console.log("Transaction sent! Hash:", transactionResponse.hash);
30
31         const receipt = await transactionResponse.wait();
32         console.log("Transaction confirmed!");
33         console.log("Block Number:", receipt.blockNumber);
34         console.log("Transaction Hash:", receipt.hash);
35     } catch (error) {
36         console.error("Error during transaction:", error);
37     }
38 }
39
40 main();
41
