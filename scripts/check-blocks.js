const { ethers } = require('ethers')

const MAX_BLOCK_RANGE = 1000

function parseInteger (name, value, positive = false) {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a ${positive ? 'positive' : 'non-negative'} integer`)
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || (positive ? parsed <= 0 : parsed < 0)) {
    throw new Error(`${name} must be a ${positive ? 'positive' : 'non-negative'} safe integer`)
  }

  return parsed
}

function getBlockRange (env, latestBlock) {
  if (!Number.isSafeInteger(latestBlock) || latestBlock < 0) {
    throw new Error('Latest block must be a non-negative safe integer')
  }

  const blockCount = parseInteger('BLOCK_COUNT', env.BLOCK_COUNT || '1', true)
  const startBlock = env.START_BLOCK
    ? parseInteger('START_BLOCK', env.START_BLOCK)
    : Math.max(latestBlock - blockCount + 1, 0)
  const endBlock = env.END_BLOCK
    ? parseInteger('END_BLOCK', env.END_BLOCK)
    : latestBlock

  if (startBlock > endBlock) {
    throw new Error('START_BLOCK must be less than or equal to END_BLOCK')
  }

  if (endBlock - startBlock + 1 > MAX_BLOCK_RANGE) {
    throw new Error(`Block range must not exceed ${MAX_BLOCK_RANGE} blocks`)
  }

  return { endBlock, startBlock }
}

async function main (env = process.env, dependencies = ethers, logger = console) {
  if (!env.RPC_URL) {
    throw new Error('RPC_URL is required')
  }

  const provider = new dependencies.JsonRpcProvider(env.RPC_URL)

  const latestBlock = await provider.getBlockNumber()
  const { endBlock, startBlock } = getBlockRange(env, latestBlock)

  logger.log(`Checking blocks ${startBlock} to ${endBlock} (latest: ${latestBlock})`)

  for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
    const block = await provider.getBlock(blockNumber)

    if (!block) {
      logger.log(`Block ${blockNumber}: not found`)
      continue
    }

    logger.log(`Block ${block.number} (${block.hash}) - ${block.transactions.length} transaction(s)`)

    for (const txHash of block.transactions) {
      logger.log(`  tx: ${txHash}`)
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = { getBlockRange, main, parseInteger, MAX_BLOCK_RANGE }
