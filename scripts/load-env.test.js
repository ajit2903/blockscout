const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { loadEnv } = require('./load-env')

test('loadEnv loads variables from .env if present', () => {
  const rootDir = path.join(__dirname, '..')
  const envPath = path.join(rootDir, '.env')
  const envLocalPath = path.join(rootDir, '.env.local')

  // Back up existing values
  const originalEnv = { ...process.env }

  // Temporarily write test files if not present, or mock fs
  const hasEnv = fs.existsSync(envPath)
  const hasEnvLocal = fs.existsSync(envLocalPath)

  let envBackup, envLocalBackup
  if (hasEnv) envBackup = fs.readFileSync(envPath, 'utf8')
  if (hasEnvLocal) envLocalBackup = fs.readFileSync(envLocalPath, 'utf8')

  try {
    fs.writeFileSync(envPath, 'TEST_VAR_ONE=hello\nTEST_VAR_TWO="world"\n# comment\nTEST_VAR_THREE=\'foo\'\n')
    fs.writeFileSync(envLocalPath, 'TEST_VAR_FOUR=local\nTEST_VAR_ONE=ignored\n')

    // Clear process.env for these specific vars
    delete process.env.TEST_VAR_ONE
    delete process.env.TEST_VAR_TWO
    delete process.env.TEST_VAR_THREE
    delete process.env.TEST_VAR_FOUR

    loadEnv()

    assert.equal(process.env.TEST_VAR_ONE, 'hello') // .env has priority if already set, wait, let's verify order of loading
    assert.equal(process.env.TEST_VAR_TWO, 'world')
    assert.equal(process.env.TEST_VAR_THREE, 'foo')
    assert.equal(process.env.TEST_VAR_FOUR, 'local')
  } finally {
    // Cleanup/restore
    if (hasEnv) {
      fs.writeFileSync(envPath, envBackup)
    } else {
      try { fs.unlinkSync(envPath) } catch {}
    }

    if (hasEnvLocal) {
      fs.writeFileSync(envLocalPath, envLocalBackup)
    } else {
      try { fs.unlinkSync(envLocalPath) } catch {}
    }

    // Restore process.env
    process.env = originalEnv
  }
})
