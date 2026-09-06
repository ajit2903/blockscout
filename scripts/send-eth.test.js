const assert = require('node:assert/strict')
const test = require('node:test')

const { loadConfig, main, sendEth } = require('./send-eth')

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

test('dry run logs correct information in main', async () => {
  const logged = []
  const logger = {
    log: (...args) => logged.push(args.join(' '))
  }

  class Provider {
    async getNetwork () {
      return { chainId: 1n }
    }
  }

  const deps = {
    JsonRpcProvider: Provider
  }

  const result = await main(
    VALID_ENV,
    deps,
    logger
  )

  assert.equal(result.broadcast, false)
  assert.deepEqual(result.tx, {
    to: '0x0000000000000000000000000000000000000001',
    value: 10000000000000000n // 0.01 ETH in Wei
  })
  assert.ok(logged.some(line => line.includes('Dry run: 0.01 ETH to 0x0000000000000000000000000000000000000001 on chain 1')))
})

test('broadcasts transaction with correct parameters in main', async () => {
  const logged = []
  const logger = {
    log: (...args) => logged.push(args.join(' '))
  }

  let txSent = null
  let walletCreated = false

  class Provider {
    async getNetwork () {
      return { chainId: 1n }
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
    Wallet
  }

  const result = await main(
    {
      ...VALID_ENV,
      BROADCAST: 'true',
      PRIVATE_KEY: '0xprivatekey',
      CONFIRM_TRANSACTION: 'SEND 0.01 ETH TO 0x0000000000000000000000000000000000000001 ON CHAIN 1'
    },
    deps,
    logger
  )

  assert.equal(result.broadcast, true)
  assert.equal(walletCreated, true)
  assert.deepEqual(txSent, {
    to: '0x0000000000000000000000000000000000000001',
    value: 10000000000000000n
  })
  assert.equal(result.receipt.blockNumber, 11)
  assert.ok(logged.some(line => line.includes('Transaction hash: 0xhash')))
  assert.ok(logged.some(line => line.includes('Transaction confirmed in block 11')))
})

test('merges custom transaction options from TX_OPTIONS and individual environment variables', () => {
  const config = loadConfig({
    ...VALID_ENV,
    TX_OPTIONS: '{"gasLimit":"21000","nonce":"42"}',
    GAS_PRICE: '1000000000',
    DATA: '0x1234'
  })

  assert.equal(config.txOptions.gasLimit, 21000n)
  assert.equal(config.txOptions.nonce, 42)
  assert.equal(config.txOptions.gasPrice, 1000000000n)
  assert.equal(config.txOptions.data, '0x1234')
})

test('throws on invalid TX_OPTIONS JSON string', () => {
  assert.throws(() => loadConfig({
    ...VALID_ENV,
    TX_OPTIONS: 'not-valid-json'
  }), /TX_OPTIONS must be a valid JSON string/)
})

test('broadcasts transaction in sequential parts when PART_SIZE_ETH is specified', async () => {
  const logged = []
  const logger = {
    log: (...args) => logged.push(args.join(' '))
  }

  const txsSent = []
  class Provider {
    async getNetwork () {
      return { chainId: 1n }
    }
  }

  class Wallet {
    async sendTransaction (tx) {
      txsSent.push(tx)
      return {
        hash: `0xhash${txsSent.length}`,
        wait: async () => ({ blockNumber: 10 + txsSent.length })
      }
    }
  }

  const deps = {
    JsonRpcProvider: Provider,
    Wallet,
    formatEther: (val) => (Number(val) / 1e18).toString(),
    parseEther: (val) => BigInt(Number(val) * 1e18)
  }

  const result = await main(
    {
      ...VALID_ENV,
      AMOUNT_ETH: '12',
      PART_SIZE_ETH: '5',
      BROADCAST: 'true',
      PRIVATE_KEY: '0xprivatekey',
      CONFIRM_TRANSACTION: 'SEND 12 ETH TO 0x0000000000000000000000000000000000000001 ON CHAIN 1'
    },
    deps,
    logger
  )

  assert.equal(result.broadcast, true)
  assert.equal(txsSent.length, 3)
  assert.deepEqual(txsSent[0], { to: '0x0000000000000000000000000000000000000001', value: 5000000000000000000n })
  assert.deepEqual(txsSent[1], { to: '0x0000000000000000000000000000000000000001', value: 5000000000000000000n })
  assert.deepEqual(txsSent[2], { to: '0x0000000000000000000000000000000000000001', value: 2000000000000000000n })
  assert.ok(logged.some(line => line.includes('Sending part 1/3: 5 ETH...')))
  assert.ok(logged.some(line => line.includes('Sending part 2/3: 5 ETH...')))
  assert.ok(logged.some(line => line.includes('Sending part 3/3: 2 ETH...')))
})

test('automatically falls back to sending in parts when direct transaction fails', async () => {
  const logged = []
  const logger = {
    log: (...args) => logged.push(args.join(' '))
  }

  const txsSent = []
  class Provider {
    async getNetwork () {
      return { chainId: 1n }
    }
  }

  class Wallet {
    async sendTransaction (tx) {
      if (txsSent.length === 0) {
        txsSent.push(tx) // direct attempt
        throw new Error('Transaction pool full or gas too low')
      }
      txsSent.push(tx)
      return {
        hash: `0xhashfallback${txsSent.length}`,
        wait: async () => ({ blockNumber: 10 + txsSent.length })
      }
    }
  }

  const deps = {
    JsonRpcProvider: Provider,
    Wallet,
    formatEther: (val) => (Number(val) / 1e18).toString(),
    parseEther: (val) => BigInt(Number(val) * 1e18)
  }

  const result = await main(
    {
      ...VALID_ENV,
      AMOUNT_ETH: '12',
      BROADCAST: 'true',
      PRIVATE_KEY: '0xprivatekey',
      CONFIRM_TRANSACTION: 'SEND 12 ETH TO 0x0000000000000000000000000000000000000001 ON CHAIN 1'
    },
    deps,
    logger
  )

  assert.equal(result.broadcast, true)
  assert.equal(txsSent.length, 4) // 1 direct attempt + 3 chunks of 5 ETH
  assert.deepEqual(txsSent[0], { to: '0x0000000000000000000000000000000000000001', value: 12000000000000000000n })
  assert.deepEqual(txsSent[1], { to: '0x0000000000000000000000000000000000000001', value: 5000000000000000000n })
  assert.deepEqual(txsSent[2], { to: '0x0000000000000000000000000000000000000001', value: 5000000000000000000n })
  assert.deepEqual(txsSent[3], { to: '0x0000000000000000000000000000000000000001', value: 2000000000000000000n })
  assert.ok(logged.some(line => line.includes('Direct transaction failed: Transaction pool full or gas too low')))
  assert.ok(logged.some(line => line.includes('Falling back to sending in parts of 5 ETH...')))
})



