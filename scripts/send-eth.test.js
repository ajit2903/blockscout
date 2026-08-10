const assert = require('node:assert/strict')
const test = require('node:test')

const { loadConfig, sendEth } = require('./send-eth')

const VALID_ENV = {
  AMOUNT_ETH: '0.01',
  CHAIN_ID: '1',
  RPC_URL: 'https://rpc.example',
  TO_ADDRESS: '0x0000000000000000000000000000000000000001'
}

test('requires an explicit recipient and amount', () => {
  assert.throws(() => loadConfig({ ...VALID_ENV, TO_ADDRESS: '' }), /TO_ADDRESS is required/)
  assert.throws(() => loadConfig({ ...VALID_ENV, AMOUNT_ETH: '' }), /AMOUNT_ETH is required/)
})

test('validates transaction inputs', () => {
  assert.throws(
    () => loadConfig({ ...VALID_ENV, TO_ADDRESS: 'not-an-address' }),
    /valid Ethereum address/
  )
  assert.throws(() => loadConfig({ ...VALID_ENV, AMOUNT_ETH: '0' }), /greater than zero/)
  assert.throws(() => loadConfig({ ...VALID_ENV, CHAIN_ID: 'mainnet' }), /positive integer/)
})

test('defaults to a dry run without requiring a private key', () => {
  const config = loadConfig(VALID_ENV)

  assert.equal(config.broadcast, false)
  assert.equal(config.privateKey, undefined)
})

test('requires an exact confirmation before broadcasting', () => {
  const env = {
    ...VALID_ENV,
    BROADCAST: 'true',
    PRIVATE_KEY: `0x${'11'.repeat(32)}`
  }

  assert.throws(() => loadConfig(env), /Set CONFIRM_TRANSACTION=/)

  const dryRun = loadConfig(VALID_ENV)
  const config = loadConfig({ ...env, CONFIRM_TRANSACTION: dryRun.confirmation })
  assert.equal(config.broadcast, true)
})

test('does not create a wallet or send during a dry run', async () => {
  let walletCreated = false

  class Provider {
    async getNetwork () {
      return { chainId: 1n }
    }
  }

  class Wallet {
    constructor () {
      walletCreated = true
    }
  }

  const result = await sendEth(loadConfig(VALID_ENV), {
    JsonRpcProvider: Provider,
    Wallet
  }, { log: () => {} })

  assert.equal(result.broadcast, false)
  assert.equal(walletCreated, false)
})

test('fails on a chain mismatch before creating a wallet', async () => {
  let walletCreated = false

  class Provider {
    async getNetwork () {
      return { chainId: 2n }
    }
  }

  class Wallet {
    constructor () {
      walletCreated = true
    }
  }

  await assert.rejects(
    sendEth(loadConfig(VALID_ENV), { JsonRpcProvider: Provider, Wallet }, { log: () => {} }),
    /does not match expected CHAIN_ID/
  )
  assert.equal(walletCreated, false)
})
