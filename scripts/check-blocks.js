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
  const endBlock = env.END_BLOCK
    ? parseInteger('END_BLOCK', env.END_BLOCK)
    : latestBlock
  const startBlock = env.START_BLOCK
    ? parseInteger('START_BLOCK', env.START_BLOCK)
    : Math.max(endBlock - blockCount + 1, 0)

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

  const targetAddress = (env.TARGET_ADDRESS || '0x06EE840642a33367ee59fCA237F270d5119d1356').toLowerCase()

  logger.log(`Checking blocks ${startBlock} to ${endBlock} (latest: ${latestBlock})`)
  logger.log(`Filtering for target address: ${targetAddress}`)

  for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
    let block
    try {
      block = await provider.send('eth_getBlockByNumber', [dependencies.toBeHex(blockNumber), true])
    } catch {
      try {
        block = await provider.getBlock(blockNumber, true)
      } catch (err) {
        logger.log(`Block ${blockNumber}: failed to fetch (${err.message})`)
        continue
      }
    }

    if (!block) {
      logger.log(`Block ${blockNumber}: not found`)
      continue
    }

    let number = blockNumber
    let hash = ''
    const transactions = []
    const withdrawals = []

    if (typeof block.number === 'number') {
      // Ethers Block class
      number = block.number
      hash = block.hash
      let prefetched = []
      try {
        prefetched = block.prefetchedTransactions || block.transactions || []
      } catch {
        prefetched = block.transactions || []
      }
      for (const tx of prefetched) {
        if (tx && typeof tx === 'object') {
          transactions.push({
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: tx.value
          })
        } else {
          transactions.push({ hash: tx })
        }
      }
    } else {
      // Raw JSON-RPC response object
      number = typeof block.number === 'string' && block.number.startsWith('0x')
        ? parseInt(block.number, 16)
        : Number(block.number || blockNumber)
      hash = block.hash
      if (Array.isArray(block.transactions)) {
        for (const tx of block.transactions) {
          if (tx && typeof tx === 'object') {
            transactions.push({
              hash: tx.hash,
              from: tx.from,
              to: tx.to,
              value: tx.value
            })
          } else {
            transactions.push({ hash: tx })
          }
        }
      }
      if (Array.isArray(block.withdrawals)) {
        for (const w of block.withdrawals) {
          withdrawals.push({
            address: w.address,
            amount: w.amount
          })
        }
      }
    }

    logger.log(`Block ${number} (${hash}) - ${transactions.length} transaction(s)`)

    for (const tx of transactions) {
      logger.log(`  tx: ${tx.hash}`)

      const from = (tx.from || '').toLowerCase()
      const to = (tx.to || '').toLowerCase()

      if (from === targetAddress) {
        const val = tx.value ? dependencies.formatEther(tx.value) : '0'
        logger.log(`    MATCH - withdrawal from target address: ${val} ETH to ${tx.to}`)
      }
      if (to === targetAddress) {
        const val = tx.value ? dependencies.formatEther(tx.value) : '0'
        logger.log(`    MATCH - deposit to target address: ${val} ETH from ${tx.from}`)
      }
    }

    for (const w of withdrawals) {
      const wAddress = (w.address || '').toLowerCase()
      if (wAddress === targetAddress) {
        let amt = w.amount
        if (typeof amt === 'string' || typeof amt === 'number') {
          try {
            amt = BigInt(amt)
          } catch {
            // Keep original if parsing fails
          }
        }
        const ethVal = typeof amt === 'bigint' ? dependencies.formatUnits(amt, 9) : amt
        logger.log(`    MATCH - beacon chain withdrawal to target address: ${ethVal} ETH`)
      }
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
