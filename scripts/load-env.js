const fs = require('node:fs')
const path = require('node:path')

function loadEnv () {
  const rootDir = path.join(__dirname, '..')
  const envFiles = ['.env', '.env.local']

  for (const file of envFiles) {
    const filePath = path.join(rootDir, file)
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue

        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
        if (match) {
          const key = match[1]
          let value = (match[2] || '').trim()

          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1)
          }

          if (process.env[key] === undefined) {
            process.env[key] = value
          }
        }
      }
    }
  }
}

module.exports = { loadEnv }
