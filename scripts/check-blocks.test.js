const assert = require('node:assert/strict')
const test = require('node:test')

const { getBlockRange, main, parseInteger, MAX_BLOCK_RANGE } = require('./check-blocks')

test('requires finite safe integer configuration', () => {
  for (const value of ['abc', '-1', '1.5', 'Infinity', '9007199254740992']) {
    assert.throws(() => parseInteger('START_BLOCK', value), /non-negative/)
  }
})

test('requires a positive block count', () => {
  for (const value of ['0', '-1', 'abc']) {
    assert.throws(() => getBlockRange({ BLOCK_COUNT: value }, 10), /BLOCK_COUNT/)
  }
})

test('calculates the default range from block count', () => {
  assert.deepEqual(getBlockRange({ BLOCK_COUNT: '3' }, 10), {
    endBlock: 10,
    startBlock: 8
  })
})

test('accepts explicit valid block bounds', () => {
  assert.deepEqual(getBlockRange({ START_BLOCK: '4', END_BLOCK: '6' }, 10), {
    endBlock: 6,
    startBlock: 4
  })
})

test('rejects a reversed block range', () => {
  assert.throws(
    () => getBlockRange({ START_BLOCK: '7', END_BLOCK: '6' }, 10),
    /START_BLOCK must be less than or equal to END_BLOCK/
  )
})

test('rejects ranges that are too large', () => {
  assert.throws(
    () => getBlockRange({ START_BLOCK: '0', END_BLOCK: String(MAX_BLOCK_RANGE) }, MAX_BLOCK_RANGE),
    new RegExp(`must not exceed ${MAX_BLOCK_RANGE}`)
  )
})

test('validates configuration before iterating blocks', async () => {
  let getBlockCalled = false

  class Provider {
    async getBlockNumber () {
      return 10
    }

    async getBlock () {
      getBlockCalled = true
    }
  }

  await assert.rejects(
    main(
      { RPC_URL: 'https://rpc.example', END_BLOCK: 'Infinity' },
      { JsonRpcProvider: Provider },
      { log: () => {} }
    ),
    /END_BLOCK/
  )
  assert.equal(getBlockCalled, false)
})

test('detects deposits, withdrawals, and beacon chain withdrawals for target address', async () => {
  const logged = []
  const logger = {
    log: (...args) => logged.push(args.join(' '))
  }

  const mockBlock = {
    number: '0xa',
    hash: '0xblockhash',
    transactions: [
      {
        hash: '0xtx1',
        from: '0x06EE840642a33367ee59fCA237F270d5119d1356',
        to: '0xrecipient',
        value: 1000000000000000000n
      },
      {
        hash: '0xtx2',
        from: '0xsender',
        to: '0x06EE840642a33367ee59fCA237F270d5119d1356',
        value: 2000000000000000000n
      }
    ],
    withdrawals: [
      {
        address: '0x06EE840642a33367ee59fCA237F270d5119d1356',
        amount: '0x3b9aca00' // 1 Gwei
      }
    ]
  }

  let sendCalled = false
  class Provider {
    async getBlockNumber () {
      return 10
    }

    async send (method) {
      if (method === 'eth_getBlockByNumber') {
        sendCalled = true
        return mockBlock
      }
    }
  }

  const deps = {
    JsonRpcProvider: Provider,
    toBeHex: (val) => '0x' + val.toString(16),
    formatEther: (val) => (Number(val) / 1e18).toString(),
    formatUnits: (val) => (Number(val) / 1e9).toString()
  }

  await main(
    { RPC_URL: 'https://rpc.example', START_BLOCK: '10', END_BLOCK: '10' },
    deps,
    logger
  )

  assert.equal(sendCalled, true)
  assert.ok(logged.some(line => line.includes('Checking blocks 10 to 10')))
  assert.ok(logged.some(line => line.includes('Filtering for target address: 0x06ee840642a33367ee59fca237f270d5119d1356')))
  assert.ok(logged.some(line => line.includes('MATCH - withdrawal from target address: 1 ETH to 0xrecipient')))
  assert.ok(logged.some(line => line.includes('MATCH - deposit to target address: 2 ETH from 0xsender')))
  assert.ok(logged.some(line => line.includes('MATCH - beacon chain withdrawal to target address: 1 ETH')))
})

test('falls back to getBlock when provider.send fails and supports custom TARGET_ADDRESS', async () => {
  const logged = []
  const logger = {
    log: (...args) => logged.push(args.join(' '))
  }

  const mockBlock = {
    number: 10,
    hash: '0xblockhash',
    prefetchedTransactions: [
      {
        hash: '0xtx1',
        from: '0xcustomtarget',
        to: '0xrecipient',
        value: 1500000000000000000n
      }
    ]
  }

  let getBlockCalled = false
  class Provider {
    async getBlockNumber () {
      return 10
    }

    async send () {
      throw new Error('RPC send failed')
    }

    async getBlock (num, prefetch) {
      if (num === 10 && prefetch === true) {
        getBlockCalled = true
        return mockBlock
      }
    }
  }

  const deps = {
    JsonRpcProvider: Provider,
    toBeHex: (val) => '0x' + val.toString(16),
    formatEther: (val) => (Number(val) / 1e18).toString()
  }

  await main(
    { RPC_URL: 'https://rpc.example', START_BLOCK: '10', END_BLOCK: '10', TARGET_ADDRESS: '0xcustomtarget' },
    deps,
    logger
  )

  assert.equal(getBlockCalled, true)
  assert.ok(logged.some(line => line.includes('Filtering for target address: 0xcustomtarget')))
  assert.ok(logged.some(line => line.includes('MATCH - withdrawal from target address: 1.5 ETH to 0xrecipient')))
})

test('calculates correct start block when END_BLOCK is specified but START_BLOCK is not', () => {
  assert.deepEqual(getBlockRange({ BLOCK_COUNT: '3', END_BLOCK: '5' }, 10), {
    endBlock: 5,
    startBlock: 3
  })
})

test('gracefully handles error when block.prefetchedTransactions throws', async () => {
  const logged = []
  const logger = {
    log: (...args) => logged.push(args.join(' '))
  }

  const mockBlock = {
    number: 10,
    hash: '0xblockhash',
    get prefetchedTransactions () {
      throw new Error('prefetchedTransactions error')
    },
    transactions: [
      {
        hash: '0xtx1',
        from: '0x06EE840642a33367ee59fCA237F270d5119d1356',
        to: '0xrecipient',
        value: 1000000000000000000n
      }
    ]
  }

  class Provider {
    async getBlockNumber () {
      return 10
    }

    async send () {
      throw new Error('RPC send failed')
    }

    async getBlock () {
      return mockBlock
    }
  }

  const deps = {
    JsonRpcProvider: Provider,
    toBeHex: (val) => '0x' + val.toString(16),
    formatEther: (val) => (Number(val) / 1e18).toString()
  }

  await main(
    { RPC_URL: 'https://rpc.example', START_BLOCK: '10', END_BLOCK: '10' },
    deps,
    logger
  )

  assert.ok(logged.some(line => line.includes('MATCH - withdrawal from target address: 1 ETH to 0xrecipient')))
})

test('supports base-10 string withdrawal amounts in Gwei formatted to ETH', async () => {
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
        address: '0x06EE840642a33367ee59fCA237F270d5119d1356',
        amount: '3000000' // 3 million Gwei = 0.003 ETH
      }
    ]
  }

  class Provider {
    async getBlockNumber () {
      return 10
    }

    async send () {
      return mockBlock
    }
  }

  const deps = {
    JsonRpcProvider: Provider,
    toBeHex: (val) => '0x' + val.toString(16),
    formatUnits: (val, dec) => (Number(val) / 10**dec).toString()
  }

  await main(
    { RPC_URL: 'https://rpc.example', START_BLOCK: '10', END_BLOCK: '10' },
    deps,
    logger
  )

  assert.ok(logged.some(line => line.includes('MATCH - beacon chain withdrawal to target address: 0.003 ETH')))
})
