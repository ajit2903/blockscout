const assert = require('node:assert/strict')
const test = require('node:test')

const { loadConfig, main, withdraw } = require('./withdraw')

const VALID_ENV = {
  CHAIN_ID: '1',
  RPC_URL: 'https://rpc.example',
  TO_ADDRESS: '0x0000000000000000000000000000000000000001'
}

test('requires an explicit recipient', () => {
  assert.throws(() => loadConfig({ ...VALID_ENV, TO_ADDRESS: '' }, 1000000000n), /TO_ADDRESS is required/)
})

test('validates transaction inputs', () => {
  assert.throws(
    () => loadConfig({ ...VALID_ENV, TO_ADDRESS: 'not-an-address' }, 1000000000n),
    /valid Ethereum address/
  )
  assert.throws(() => loadConfig({ ...VALID_ENV, CHAIN_ID: 'mainnet' }, 1000000000n), /positive integer/)
})

test('defaults to a dry run without requiring a private key', () => {
  const config = loadConfig(VALID_ENV, 1000000000000000000n)

  assert.equal(config.broadcast, false)
  assert.equal(config.privateKey, undefined)
  assert.equal(config.amountEth, '1.0')
})

test('requires an exact confirmation before broadcasting', () => {
  const env = {
    ...VALID_ENV,
    BROADCAST: 'true',
    PRIVATE_KEY: `0x${'11'.repeat(32)}`
  }

  assert.throws(() => loadConfig(env, 1000000000000000000n), /Set CONFIRM_TRANSACTION=/)

  const dryRun = loadConfig(VALID_ENV, 1000000000000000000n)
  const config = loadConfig({ ...env, CONFIRM_TRANSACTION: dryRun.confirmation }, 1000000000000000000n)
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

  const result = await withdraw(loadConfig(VALID_ENV, 1000000000000000000n), {
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
    withdraw(loadConfig(VALID_ENV, 1000000000000000000n), { JsonRpcProvider: Provider, Wallet }, { log: () => {} }),
    /does not match expected CHAIN_ID/
  )
  assert.equal(walletCreated, false)
})

test('calculates correct withdrawals sum and logs it in main', async () => {
  const logged = []
  const logger = {
    log: (...args) => logged.push(args.join(' '))
  }

  const mockBlock = {
    number: '0xa',
    hash: '0xblockhash',
    transactions: [],
    withdrawals: [
      {
        address: '0x0000000000000000000000000000000000000001',
        amount: '3000000' // 3 million Gwei = 0.003 ETH
      },
      {
        address: '0x0000000000000000000000000000000000000002',
        amount: '0x1e8480' // 2 million Gwei = 0.002 ETH
      }
    ]
  }

  class Provider {
    async getNetwork () {
      return { chainId: 1n }
    }

    async getBlockNumber () {
      return 10
    }

    async send (method) {
      if (method === 'eth_getBlockByNumber') {
        return mockBlock
      }
    }
  }

  const deps = {
    JsonRpcProvider: Provider,
    toBeHex: (val) => '0x' + val.toString(16),
    formatEther: (val) => (Number(val) / 1e18).toString()
  }

  const result = await main(
    { RPC_URL: 'https://rpc.example', START_BLOCK: '10', END_BLOCK: '10', TO_ADDRESS: '0x0000000000000000000000000000000000000001', CHAIN_ID: '1' },
    deps,
    logger
  )

  assert.equal(result.broadcast, false)
  assert.equal(result.value, 5000000000000000n) // 0.005 ETH in Wei
  assert.ok(logged.some(line => line.includes('Scanning blocks 10 to 10 for funds to withdraw...')))
  assert.ok(logged.some(line => line.includes('Total blocks funds found: 0.005 ETH')))
})

test('broadcasts transaction with correct parameters', async () => {
  const logged = []
  const logger = {
    log: (...args) => logged.push(args.join(' '))
  }

  const mockBlock = {
    number: '0xa',
    hash: '0xblockhash',
    transactions: [],
    withdrawals: [
      {
        address: '0x0000000000000000000000000000000000000001',
        amount: '1000000' // 0.001 ETH
      }
    ]
  }

  let txSent = null
  let walletCreated = false

  class Provider {
    async getNetwork () {
      return { chainId: 1n }
    }

    async getBlockNumber () {
      return 10
    }

    async send (method) {
      if (method === 'eth_getBlockByNumber') {
        return mockBlock
      }
    }
  }

  class Wallet {
    constructor (key, provider) {
      walletCreated = true
      assert.equal(key, '0xprivatekey')
    }

    async sendTransaction (tx) {
      txSent = tx
      return {
        hash: '0xhash',
        wait: async () => ({ blockNumber: 11 })
      }
    }
  }

  const deps = {
    JsonRpcProvider: Provider,
    Wallet,
    toBeHex: (val) => '0x' + val.toString(16),
    formatEther: (val) => (Number(val) / 1e18).toString()
  }

  const result = await main(
    {
      RPC_URL: 'https://rpc.example',
      START_BLOCK: '10',
      END_BLOCK: '10',
      TO_ADDRESS: '0x0000000000000000000000000000000000000001',
      CHAIN_ID: '1',
      BROADCAST: 'true',
      PRIVATE_KEY: '0xprivatekey',
      CONFIRM_TRANSACTION: 'WITHDRAW 0.001 ETH TO 0x0000000000000000000000000000000000000001 ON CHAIN 1'
    },
    deps,
    logger
  )

  assert.equal(result.broadcast, true)
  assert.equal(walletCreated, true)
  assert.deepEqual(txSent, {
    to: '0x0000000000000000000000000000000000000001',
    value: 1000000000000000n // 0.001 ETH in Wei
  })
  assert.equal(result.receipt.blockNumber, 11)
  assert.ok(logged.some(line => line.includes('Transaction hash: 0xhash')))
  assert.ok(logged.some(line => line.includes('Transaction confirmed in block 11')))
})
