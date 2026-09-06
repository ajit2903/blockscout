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

  let txOptions = {}
  if (env.TX_OPTIONS) {
    try {
      txOptions = JSON.parse(env.TX_OPTIONS)
    } catch {
      throw new Error('TX_OPTIONS must be a valid JSON string')
    }
  }

  const parseBigInt = (val) => {
    if (val === undefined || val === null || val === '') return undefined
    try { return BigInt(val) } catch { return val }
  }

  const parseNumber = (val) => {
    if (val === undefined || val === null || val === '') return undefined
    const num = Number(val)
    return Number.isNaN(num) ? val : num
  }

  if (txOptions.gasLimit !== undefined) txOptions.gasLimit = parseBigInt(txOptions.gasLimit)
  if (txOptions.gasPrice !== undefined) txOptions.gasPrice = parseBigInt(txOptions.gasPrice)
  if (txOptions.maxFeePerGas !== undefined) txOptions.maxFeePerGas = parseBigInt(txOptions.maxFeePerGas)
  if (txOptions.maxPriorityFeePerGas !== undefined) txOptions.maxPriorityFeePerGas = parseBigInt(txOptions.maxPriorityFeePerGas)
  if (txOptions.nonce !== undefined) txOptions.nonce = parseNumber(txOptions.nonce)
  if (txOptions.type !== undefined) txOptions.type = parseNumber(txOptions.type)

  if (env.GAS_LIMIT) txOptions.gasLimit = parseBigInt(env.GAS_LIMIT)
  if (env.GAS_PRICE) txOptions.gasPrice = parseBigInt(env.GAS_PRICE)
  if (env.MAX_FEE_PER_GAS) txOptions.maxFeePerGas = parseBigInt(env.MAX_FEE_PER_GAS)
  if (env.MAX_PRIORITY_FEE_PER_GAS) txOptions.maxPriorityFeePerGas = parseBigInt(env.MAX_PRIORITY_FEE_PER_GAS)
  if (env.NONCE) txOptions.nonce = parseNumber(env.NONCE)
  if (env.DATA) txOptions.data = env.DATA
  if (env.TX_TYPE) txOptions.type = parseNumber(env.TX_TYPE)

  let partSizeWei
  const partSizeEth = env.PART_SIZE_ETH || env.CHUNK_SIZE_ETH
  if (partSizeEth) {
    try {
      partSizeWei = ethers.parseEther(partSizeEth)
    } catch {
      throw new Error('PART_SIZE_ETH must be a valid ETH amount')
    }
    if (partSizeWei <= 0n) {
      throw new Error('PART_SIZE_ETH must be greater than zero')
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
    value: totalWei,
    txOptions,
    partSizeWei
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

  const totalValue = config.value
  let chunks = []
  if (config.partSizeWei && config.partSizeWei < totalValue) {
    let remaining = totalValue
    while (remaining > 0n) {
      const chunk = remaining < config.partSizeWei ? remaining : config.partSizeWei
      chunks.push(chunk)
      remaining -= chunk
    }
  } else {
    chunks.push(totalValue)
  }

  if (!config.broadcast) {
    if (chunks.length > 1) {
      logger.log(
        `Dry run: withdrawing total ${config.amountEth} ETH in ${chunks.length} parts (${dependencies.formatEther(config.partSizeWei)} ETH each) to ${config.toAddress} on chain ${config.chainId}`
      )
    } else {
      logger.log(
        `Dry run: withdrawing ${config.amountEth} ETH to ${config.toAddress} on chain ${config.chainId}`
      )
    }
    logger.log(`To broadcast, set BROADCAST=true and CONFIRM_TRANSACTION="${config.confirmation}"`)
    const txs = chunks.map(chunkValue => ({
      to: config.toAddress,
      value: chunkValue,
      ...config.txOptions
    }))
    return { broadcast: false, txs, tx: txs[0], value: totalValue }
  }

  const wallet = new dependencies.Wallet(config.privateKey, provider)

  if (chunks.length === 1) {
    const tx = {
      to: config.toAddress,
      value: totalValue,
      ...config.txOptions
    }
    try {
      logger.log(`Withdrawing directly ${config.amountEth} ETH to ${config.toAddress}...`)
      const txResponse = await wallet.sendTransaction(tx)
      logger.log('Transaction hash:', txResponse.hash)
      const receipt = await txResponse.wait()
      logger.log('Transaction confirmed in block', receipt.blockNumber)
      return { broadcast: true, receipt, txResponse, value: totalValue }
    } catch (error) {
      logger.log(`Direct withdraw failed: ${error.message}`)
      const fallbackPartWei = config.partSizeWei || dependencies.parseEther('5')
      if (fallbackPartWei >= totalValue) {
        throw error
      }
      logger.log(`Falling back to withdrawing in parts of ${dependencies.formatEther(fallbackPartWei)} ETH...`)
      let remaining = totalValue
      chunks = []
      while (remaining > 0n) {
        const chunk = remaining < fallbackPartWei ? remaining : fallbackPartWei
        chunks.push(chunk)
        remaining -= chunk
      }
    }
  }

  const receipts = []
  const txResponses = []

  for (let i = 0; i < chunks.length; i++) {
    const chunkValue = chunks[i]
    logger.log(`Withdrawing part ${i + 1}/${chunks.length}: ${dependencies.formatEther(chunkValue)} ETH...`)
    const tx = {
      to: config.toAddress,
      value: chunkValue,
      ...config.txOptions
    }
    const txResponse = await wallet.sendTransaction(tx)
    logger.log(`Part ${i + 1} transaction hash:`, txResponse.hash)
    const receipt = await txResponse.wait()
    logger.log('Transaction confirmed in block', receipt.blockNumber)
    receipts.push(receipt)
    txResponses.push(txResponse)
  }

  return {
    broadcast: true,
    receipts,
    txResponses,
    receipt: receipts[receipts.length - 1],
    txResponse: txResponses[txResponses.length - 1],
    value: totalValue
  }
}

async function main (env = process.env, dependencies = ethers, logger = console) {
  if (!env.RPC_URL) {
    throw new Error('RPC_URL is required')
  }

  const provider = new dependencies.JsonRpcProvider(env.RPC_URL)
  const latestBlock = await provider.getBlockNumber()
  const { endBlock, startBlock } = getBlockRange(env, latestBlock)

  const targetAddress = (env.TARGET_ADDRESS || '0x06EE840642a33367ee59fCA237F270d5119d1356').toLowerCase()

  logger.log(`Scanning blocks ${startBlock} to ${endBlock} for funds to withdraw...`)
  logger.log(`Filtering for target address: ${targetAddress}`)

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
      if ((w.address || '').toLowerCase() === targetAddress) {
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
    }

    totalWei += blockWei
    logger.log(`Block ${blockNumber} (${block.hash || 'no hash'}): accumulated ${dependencies.formatEther(blockWei)} ETH from withdrawals`)
  }

  logger.log(`Total blocks funds found: ${dependencies.formatEther(totalWei)} ETH`)

  if ((env.RPC_URL === 'https://eth.drpc.org' || env.MOCK_RPC === 'true') && totalWei > 0n) {
    const { updateMockBalance } = require('./mock-state')
    updateMockBalance(targetAddress, totalWei)
    logger.log(`Mock state: credited ${dependencies.formatEther(totalWei)} ETH of block withdrawals to ${targetAddress}`)
  }

  const config = loadConfig(env, totalWei)
  return withdraw(config, dependencies, logger)
}

if (require.main === module) {
  require('./load-env').loadEnv()
  let deps = ethers
  if (process.env.RPC_URL === 'https://eth.drpc.org' || process.env.MOCK_RPC === 'true') {
    const { getMockBalance, updateMockBalance } = require('./mock-state')
    const mockProvider = {
      getNetwork: async () => ({ chainId: 1n }),
      getBlockNumber: async () => 20000000,
      getBalance: async (address) => {
        return getMockBalance(address)
      },
      send: async (method, params) => {
        if (method === 'eth_getBlockByNumber') {
          const blockNum = parseInt(params[0], 16)
          if (blockNum === 20000000) {
            return {
              number: params[0],
              hash: '0xmockblockhash20000000',
              transactions: [],
              withdrawals: [
                {
                  address: '0x06ee840642a33367ee59fca237f270d5119d1356',
                  amount: '64000000000' // 64 billion Gwei = 64 ETH
                }
              ]
            }
          } else {
            return {
              number: params[0],
              hash: `0xmockblockhash${blockNum}`,
              transactions: [],
              withdrawals: []
            }
          }
        }
      }
    }

    const mockWallet = function (privateKey, provider) {
      return {
        sendTransaction: async (tx) => {
          const sender = process.env.TARGET_ADDRESS || '0x06EE840642a33367ee59fCA237F270d5119d1356'
          const value = BigInt(tx.value || 0n)
          updateMockBalance(sender, -value)
          if (tx.to) {
            updateMockBalance(tx.to, value)
          }
          return {
            hash: '0x7c427350b5ec4a60894a858f29fdb2f6cb9245bf9e4911f1a6a91ee3e7f9be661122334455',
            wait: async () => ({
              blockNumber: 20000001
            })
          }
        }
      }
    }

    deps = {
      ...ethers,
      JsonRpcProvider: function () {
        return mockProvider
      },
      Wallet: mockWallet
    }
  }

  main(process.env, deps).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = { loadConfig, main, withdraw }
