const { ethers } = require('ethers')

function required (env, name) {
  const value = env[name]

  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

function loadConfig (env = process.env) {
  const rpcUrl = required(env, 'RPC_URL')
  const toAddress = required(env, 'TO_ADDRESS')
  const amountEth = required(env, 'AMOUNT_ETH')
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

  let value
  try {
    value = ethers.parseEther(amountEth)
  } catch {
    throw new Error('AMOUNT_ETH must be a valid ETH amount')
  }

  if (value <= 0n) {
    throw new Error('AMOUNT_ETH must be greater than zero')
  }

  if (env.BROADCAST && env.BROADCAST !== 'true' && env.BROADCAST !== 'false') {
    throw new Error('BROADCAST must be either true or false')
  }

  const broadcast = env.BROADCAST === 'true'
  const normalizedToAddress = ethers.getAddress(toAddress)
  const confirmation = `SEND ${amountEth} ETH TO ${normalizedToAddress} ON CHAIN ${chainId}`
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

  return {
    amountEth,
    broadcast,
    chainId,
    confirmation,
    privateKey,
    rpcUrl,
    toAddress: normalizedToAddress,
    value,
    txOptions
  }
}

async function sendEth (config, dependencies = ethers, logger = console) {
  const provider = new dependencies.JsonRpcProvider(config.rpcUrl)
  const network = await provider.getNetwork()

  if (network.chainId !== config.chainId) {
    throw new Error(
      `RPC chain ID ${network.chainId} does not match expected CHAIN_ID ${config.chainId}`
    )
  }

  const tx = {
    to: config.toAddress,
    value: config.value,
    ...config.txOptions
  }

  if (!config.broadcast) {
    logger.log(
      `Dry run: ${config.amountEth} ETH to ${config.toAddress} on chain ${config.chainId}`
    )
    logger.log(`To broadcast, set BROADCAST=true and CONFIRM_TRANSACTION="${config.confirmation}"`)
    return { broadcast: false, tx }
  }

  const wallet = new dependencies.Wallet(config.privateKey, provider)
  const txResponse = await wallet.sendTransaction(tx)
  logger.log('Transaction hash:', txResponse.hash)

  const receipt = await txResponse.wait()
  logger.log('Transaction confirmed in block', receipt.blockNumber)

  return { broadcast: true, receipt, txResponse }
}

async function main (env = process.env, dependencies = ethers, logger = console) {
  const config = loadConfig(env)
  return sendEth(config, dependencies, logger)
}

if (require.main === module) {
  require('./load-env').loadEnv()
  let deps = ethers
  if (process.env.RPC_URL === 'https://eth.drpc.org' || process.env.MOCK_RPC === 'true') {
    const { getMockBalance, updateMockBalance } = require('./mock-state')
    const mockProvider = {
      getNetwork: async () => {
        const chainIdInput = process.env.CHAIN_ID || '1'
        return { chainId: BigInt(chainIdInput) }
      },
      getBalance: async (address) => {
        return getMockBalance(address)
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

module.exports = { loadConfig, main, sendEth }
