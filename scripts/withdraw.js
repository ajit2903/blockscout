const { ethers } = require('ethers')
const { getBlockRange } = require('./check-blocks')

function required (env, name) {
  const value = env[name]

  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

function loadConfig (env = process.env, totalWei) {
  const rpcUrl = required(env, 'RPC_URL')
  const toAddress = required(env, 'TO_ADDRESS')
  const chainIdInput = required(env, 'CHAIN_ID')

  if (!ethers.isAddress(toAddress)) {
    throw new Error('TO_ADDRESS must be a valid Ethereum address')
  }

  if (!/^\d+$/.test(chainIdInput)) {
    throw new Error('CHAIN_ID must be a positive integer')
  }

  const chainId = BigInt(chainIdInput)
  if (chainId <= 0n) {
    throw new Error('CHAIN_ID must be a positive integer')
  }

  if (env.BROADCAST && env.BROADCAST !== 'true' && env.BROADCAST !== 'false') {
    throw new Error('BROADCAST must be either true or false')
  }

  const broadcast = env.BROADCAST === 'true'
  const normalizedToAddress = ethers.getAddress(toAddress)
  const amountEth = ethers.formatEther(totalWei)
  const confirmation = `WITHDRAW ${amountEth} ETH TO ${normalizedToAddress} ON CHAIN ${chainId}`
  let privateKey

  if (broadcast) {
    privateKey = required(env, 'PRIVATE_KEY')

    if (env.CONFIRM_TRANSACTION !== confirmation) {
      throw new Error(`Set CONFIRM_TRANSACTION="${confirmation}" to broadcast`)
    }
  }

  return {
    amountEth,
    broadcast,
    chainId,
    confirmation,
    privateKey,
    rpcUrl,
    toAddress: normalizedToAddress,
    value: totalWei
  }
}

async function withdraw (config, dependencies = ethers, logger = console) {
  const provider = new dependencies.JsonRpcProvider(config.rpcUrl)
  const network = await provider.getNetwork()

  if (network.chainId !== config.chainId) {
    throw new Error(
      `RPC chain ID ${network.chainId} does not match expected CHAIN_ID ${config.chainId}`
    )
  }

  const tx = {
    to: config.toAddress,
    value: config.value
  }

  if (!config.broadcast) {
    logger.log(
      `Dry run: withdrawing ${config.amountEth} ETH to ${config.toAddress} on chain ${config.chainId}`
    )
    logger.log(`To broadcast, set BROADCAST=true and CONFIRM_TRANSACTION="${config.confirmation}"`)
    return { broadcast: false, tx, value: config.value }
  }

  const wallet = new dependencies.Wallet(config.privateKey, provider)
  const txResponse = await wallet.sendTransaction(tx)
  logger.log('Transaction hash:', txResponse.hash)

  const receipt = await txResponse.wait()
  logger.log('Transaction confirmed in block', receipt.blockNumber)

  return { broadcast: true, receipt, txResponse, value: config.value }
}

async function main (env = process.env, dependencies = ethers, logger = console) {
  if (!env.RPC_URL) {
    throw new Error('RPC_URL is required')
  }

  const provider = new dependencies.JsonRpcProvider(env.RPC_URL)
  const latestBlock = await provider.getBlockNumber()
  const { endBlock, startBlock } = getBlockRange(env, latestBlock)

  logger.log(`Scanning blocks ${startBlock} to ${endBlock} for funds to withdraw...`)

  let totalWei = 0n

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

    const withdrawals = []
    if (Array.isArray(block.withdrawals)) {
      for (const w of block.withdrawals) {
        withdrawals.push({
          address: w.address,
          amount: w.amount
        })
      }
    }

    let blockWei = 0n
    for (const w of withdrawals) {
      let amt = w.amount
      if (typeof amt === 'string') {
        try {
          if (amt.startsWith('0x')) {
            amt = BigInt(amt)
          } else {
            amt = BigInt(amt)
          }
        } catch {
          // Fallback to 0 if parsing fails
          amt = 0n
        }
      } else if (typeof amt === 'number') {
        amt = BigInt(amt)
      } else {
        amt = 0n
      }

      // Convert Gwei to Wei (1 Gwei = 10^9 Wei)
      blockWei += amt * 1000000000n
    }

    totalWei += blockWei
    logger.log(`Block ${blockNumber} (${block.hash || 'no hash'}): accumulated ${dependencies.formatEther(blockWei)} ETH from withdrawals`)
  }

  logger.log(`Total blocks funds found: ${dependencies.formatEther(totalWei)} ETH`)

  const config = loadConfig(env, totalWei)
  return withdraw(config, dependencies, logger)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = { loadConfig, main, withdraw }
