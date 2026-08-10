const { ethers } = require('ethers')
const funding = require('../FUNDING.json')

const FUNDING_CHAIN_BY_ID = new Map([
  ['1', 'ethereum'],
  ['10', 'optimism'],
  ['314', 'filecoin'],
  ['1088', 'metis']
])

function required (env, name) {
  const value = env[name]

  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

function loadConfig (env = process.env, fundingConfig = funding) {
  const rpcUrl = required(env, 'RPC_URL')
  const amountEth = required(env, 'AMOUNT_ETH')
  const chainIdInput = required(env, 'CHAIN_ID')

  if (!/^\d+$/.test(chainIdInput)) {
    throw new Error('CHAIN_ID must be a positive integer')
  }

  const chainId = BigInt(chainIdInput)
  if (chainId <= 0n) {
    throw new Error('CHAIN_ID must be a positive integer')
  }

  const fundingChain = FUNDING_CHAIN_BY_ID.get(chainId.toString())
  if (!fundingChain) {
    throw new Error(`CHAIN_ID ${chainId} does not have a configured funding wallet`)
  }

  const configuredAddress = fundingConfig.drips?.[fundingChain]?.ownedBy
  if (!configuredAddress || !ethers.isAddress(configuredAddress)) {
    throw new Error(`FUNDING.json must define a valid ${fundingChain}.ownedBy address`)
  }

  const toAddress = ethers.getAddress(configuredAddress)
  if (env.TO_ADDRESS && ethers.getAddress(env.TO_ADDRESS) !== toAddress) {
    throw new Error(`TO_ADDRESS cannot override configured funding wallet ${toAddress}`)
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
  const confirmation = `SEND ${amountEth} ETH TO ${toAddress} ON CHAIN ${chainId}`
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
    fundingChain,
    privateKey,
    rpcUrl,
    toAddress,
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

async function main () {
  const config = loadConfig()
  return sendEth(config)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = { loadConfig, main, sendEth }
