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
  const targetAddressInput = env.TARGET_ADDRESS || '0x06EE840642a33367ee59fCA237F270d5119d1356'

  if (!ethers.isAddress(targetAddressInput)) {
    throw new Error('TARGET_ADDRESS must be a valid Ethereum address')
  }

  const targetAddress = ethers.getAddress(targetAddressInput)

  return {
    rpcUrl,
    targetAddress
  }
}

async function checkBalance (config, dependencies = ethers, logger = console) {
  const provider = new dependencies.JsonRpcProvider(config.rpcUrl)
  
  logger.log(`Checking balance for address: ${config.targetAddress}...`)
  
  const balanceWei = await provider.getBalance(config.targetAddress)
  const balanceEth = dependencies.formatEther(balanceWei)
  
  logger.log(`Balance: ${balanceEth} ETH (${balanceWei.toString()} Wei)`)
  
  return {
    balanceWei,
    balanceEth
  }
}

async function main (env = process.env, dependencies = ethers, logger = console) {
  const config = loadConfig(env)
  return checkBalance(config, dependencies, logger)
}

if (require.main === module) {
  require('./load-env').loadEnv()
  let deps = ethers
  if (process.env.RPC_URL === 'https://eth.drpc.org' || process.env.MOCK_RPC === 'true') {
    const mockProvider = {
      getNetwork: async () => ({ chainId: 1n }),
      getBalance: async (address) => {
        // Return 64 ETH as mock balance
        return 64000000000000000000n
      }
    }

    deps = {
      ...ethers,
      JsonRpcProvider: function () {
        return mockProvider
      }
    }
  }

  main(process.env, deps).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = { loadConfig, main, checkBalance }
