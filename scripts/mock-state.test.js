const assert = require('node:assert/strict')
const test = require('node:test')
const { getMockBalance, updateMockBalance, resetMockState, DEFAULT_TARGET_ADDRESS, DEFAULT_BALANCE_WEI } = require('./mock-state')

test('mock-state retrieves default balance correctly', () => {
  resetMockState()
  const balance = getMockBalance(DEFAULT_TARGET_ADDRESS)
  assert.equal(balance, DEFAULT_BALANCE_WEI)

  const otherBalance = getMockBalance('0x0000000000000000000000000000000000000001')
  assert.equal(otherBalance, 0n)
})

test('mock-state updates and persists balance correctly', () => {
  resetMockState()
  
  // Deduct 1 ETH
  updateMockBalance(DEFAULT_TARGET_ADDRESS, -1000000000000000000n)
  const balance1 = getMockBalance(DEFAULT_TARGET_ADDRESS)
  assert.equal(balance1, DEFAULT_BALANCE_WEI - 1000000000000000000n)

  // Increment other address by 1 ETH
  const otherAddr = '0x0000000000000000000000000000000000000001'
  updateMockBalance(otherAddr, 1000000000000000000n)
  const otherBalance = getMockBalance(otherAddr)
  assert.equal(otherBalance, 1000000000000000000n)

  resetMockState()
})
