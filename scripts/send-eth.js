const { ethers } = require('ethers')

async function main () {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider)

  const tx = {
    to: process.env.TO_ADDRESS,
    value: ethers.parseEther(process.env.AMOUNT_ETH || '0.01')
  }

  const txResponse = await wallet.sendTransaction(tx)
  console.log('Transaction hash:', txResponse.hash)

  const receipt = await txResponse.wait()
  console.log('Transaction confirmed in block', receipt.blockNumber)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})