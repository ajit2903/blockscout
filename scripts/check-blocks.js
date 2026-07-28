const { ethers } = require('ethers')

async function main () {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL)

  const latestBlock = await provider.getBlockNumber()
  const blockCount = Number(process.env.BLOCK_COUNT || 1)
  const startBlock = process.env.START_BLOCK
    ? Number(process.env.START_BLOCK)
    : Math.max(latestBlock - blockCount + 1, 0)
  const endBlock = process.env.END_BLOCK
    ? Number(process.env.END_BLOCK)
    : latestBlock

  console.log(`Checking blocks ${startBlock} to ${endBlock} (latest: ${latestBlock})`)

  for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
    const block = await provider.getBlock(blockNumber)

    if (!block) {
      console.log(`Block ${blockNumber}: not found`)
      continue
    }

    console.log(`Block ${block.number} (${block.hash}) - ${block.transactions.length} transaction(s)`)

    for (const txHash of block.transactions) {
      console.log(`  tx: ${txHash}`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})