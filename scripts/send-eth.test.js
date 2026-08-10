const assert = require('node:assert/strict')
const test = require('node:test')

const { loadConfig, sendEth } = require('./send-eth')

const VALID_ENV = {
  AMOUNT_ETH: '0.01',
  CHAIN_ID: '1',
  RPC_URL: 'https://rpc.example'
}

test('requires an explicit amount', () => {
  assert.throws(() => loadConfig({ ...VALID_ENV, AMOUNT_ETH: '' }), /AMOUNT_ETH is required/)
})

test('validates transaction inputs', () => {
  assert.throws(() => loadConfig({ ...VALID_ENV, AMOUNT_ETH: '0' }), /greater than zero/)
  assert.throws(() => loadConfig({ ...VALID_ENV, CHAIN_ID: 'mainnet' }), /positive integer/)
})

test('uses the chain-specific wallet from FUNDING.json', () => {
  const config = loadConfig(VALID_ENV)

  assert.equal(config.fundingChain, 'ethereum')
  assert.equal(config.toAddress, '0x06EE840642a33367ee59fCA237F270d5119d1356')
})

test('supports every production chain configured in FUNDING.json', () => {
  const expectedChains = new Map([
    ['1', 'ethereum'],
    ['10', 'optimism'],
    ['314', 'filecoin'],
    ['1088', 'metis']
  ])

  for (const [chainId, fundingChain] of expectedChains) {
    const config = loadConfig({ ...VALID_ENV, CHAIN_ID: chainId })
    assert.equal(config.fundingChain, fundingChain)
    assert.equal(config.toAddress, '0x06EE840642a33367ee59fCA237F270d5119d1356')
  }
})

test('rejects unsupported chains and recipient overrides', () => {
  assert.throws(
    () => loadConfig({ ...VALID_ENV, CHAIN_ID: '137' }),
    /does not have a configured funding wallet/
  )
  assert.throws(
    () => loadConfig({
      ...VALID_ENV,
      TO_ADDRESS: '0x0000000000000000000000000000000000000001'
    }),
    /cannot override configured funding wallet/
  )
})

test('requires a valid ownedBy address in FUNDING.json', () => {
  assert.throws(
    () => loadConfig(VALID_ENV, { drips: { ethereum: { ownedBy: 'invalid' } } }),
    /must define a valid ethereum.ownedBy address/
  )
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
