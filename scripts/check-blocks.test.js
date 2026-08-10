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
