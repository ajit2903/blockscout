const assert = require('node:assert/strict')
const test = require('node:test')

const { loadConfig, main, checkBalance } = require('./check-balance')

const VALID_ENV = {
  RPC_URL: 'https://rpc.example'
}

test('requires RPC_URL configuration', () => {
  assert.throws(() => loadConfig({}), /RPC_URL is required/)
})

test('validates target address', () => {
  assert.throws(
    () => loadConfig({ ...VALID_ENV, TARGET_ADDRESS: 'not-an-address' }),
    /TARGET_ADDRESS must be a valid Ethereum address/
  )
})

test('defaults to the default target address when none specified', () => {
  const config = loadConfig(VALID_ENV)
  assert.equal(config.targetAddress, '0x06EE840642a33367ee59fCA237F270d5119d1356')
})

test('accepts custom valid target address', () => {
  const config = loadConfig({ ...VALID_ENV, TARGET_ADDRESS: '0x0000000000000000000000000000000000000001' })
  assert.equal(config.targetAddress, '0x0000000000000000000000000000000000000001')
})

test('queries getBalance and logs the balance', async () => {
  const logged = []
  const logger = {
    log: (...args) => logged.push(args.join(' '))
  }

  class Provider {
    async getBalance (address) {
      assert.equal(address, '0x06EE840642a33367ee59fCA237F270d5119d1356')
      return 1000000000000000000n // 1 ETH
    }
  }

  const deps = {
    JsonRpcProvider: Provider,
    formatEther: (val) => (Number(val) / 1e18).toString()
  }

  const result = await main(VALID_ENV, deps, logger)
  
  assert.equal(result.balanceWei, 1000000000000000000n)
  assert.equal(result.balanceEth, '1')
  
  assert.ok(logged.some(line => line.includes('Checking balance for address: 0x06EE840642a33367ee59fCA237F270d5119d1356')))
  assert.ok(logged.some(line => line.includes('Balance: 1 ETH (1000000000000000000 Wei)')))
})
