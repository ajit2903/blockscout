const fs = require('node:fs')
const path = require('node:path')

const STATE_FILE_PATH = path.join(__dirname, '..', '.mock-balance-state.json')
const DEFAULT_TARGET_ADDRESS = '0x06EE840642a33367ee59fCA237F270d5119d1356'
const DEFAULT_BALANCE_WEI = 64000000000000000000n // 64 ETH

function readState () {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const content = fs.readFileSync(STATE_FILE_PATH, 'utf8')
      return JSON.parse(content)
    }
  } catch (err) {
    // Ignore read errors
  }
  return {}
}

function writeState (state) {
  try {
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    // Ignore write errors
  }
}

function getMockBalance (address) {
  const normalized = address.toLowerCase()
  const state = readState()
  if (state[normalized] !== undefined) {
    return BigInt(state[normalized])
  }
  if (normalized === DEFAULT_TARGET_ADDRESS.toLowerCase()) {
    return DEFAULT_BALANCE_WEI
  }
  return 0n
}

function updateMockBalance (address, changeBigInt) {
  const normalized = address.toLowerCase()
  const state = readState()
  const current = getMockBalance(normalized)
  const updated = current + changeBigInt
  state[normalized] = updated.toString()
  writeState(state)
  return updated
}

function resetMockState () {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      fs.unlinkSync(STATE_FILE_PATH)
    }
  } catch (err) {
    // Ignore errors
  }
}

module.exports = {
  getMockBalance,
  updateMockBalance,
  resetMockState,
  DEFAULT_TARGET_ADDRESS,
  DEFAULT_BALANCE_WEI
}
