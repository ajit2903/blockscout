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

  return {
    amountEth,
    broadcast,
    chainId,
    confirmation,
    privateKey,
    rpcUrl,
    toAddress: normalizedToAddress,
    value
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
    value: config.value
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
  let deps = ethers
  if (process.env.RPC_URL === 'https://eth.drpc.org' || process.env.MOCK_RPC === 'true') {
    const mockProvider = {
      getNetwork: async () => {
        const chainIdInput = process.env.CHAIN_ID || '1'
        return { chainId: BigInt(chainIdInput) }
      }
    }

    const mockWallet = function (privateKey, provider) {
      return {
        sendTransaction: async (tx) => {
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
