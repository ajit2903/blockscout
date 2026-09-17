const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const configPath = path.join(__dirname, '..', '.devcontainer', 'devcontainer.json')

function loadConfig() {
  return JSON.parse(readFileSync(configPath, 'utf8'))
}

test('devcontainer configuration is a minimal JSON object', () => {
  const config = loadConfig()

  assert.deepEqual(Object.keys(config).sort(), ['features', 'image'])
})

test('uses the pinned Microsoft Universal version 2 image', () => {
  const config = loadConfig()

  assert.equal(config.image, 'mcr.microsoft.com/devcontainers/universal:2')
})

test('starts without optional devcontainer features', () => {
  const config = loadConfig()

  assert.deepEqual(config.features, {})
})

test('does not enable a conflicting build or Compose configuration', () => {
  const config = loadConfig()
  const conflictingProperties = ['build', 'dockerFile', 'dockerComposeFile', 'service']

  for (const property of conflictingProperties) {
    assert.equal(Object.hasOwn(config, property), false, `${property} must not be configured with the image`)
  }
})
